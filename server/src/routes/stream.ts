import { Router } from "express";
import { z } from "zod";
import fs from "node:fs";
import { prisma } from "../db.js";
import type { AiClient, ChatMessage } from "../ai/client.js";
import { searchMemories, addMemory } from "../memory/store.js";
import { buildPrompt } from "../chat/prompt.js";
import { generateChatTitle } from "../chat/title.js";
import { extractFacts } from "../memory/extract.js";

const streamBodySchema = z.object({
  content: z.string().min(1),
  attachmentIds: z.array(z.string()).max(5).optional(),
});

export function createStreamRouter(getAi: () => AiClient): Router {
  const router = Router();

  // POST /:id/stream — SSE streaming turn.
  // Auth is applied by the parent chats router (router.use(requireAuth)).
  router.post("/:id/stream", async (req, res) => {
    const parsed = streamBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { content, attachmentIds } = parsed.data;
    const chatId = req.params.id as string;

    // 1. Verify the chat exists and is owned by the user
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId: req.userId! },
    });

    if (!chat) {
      res.status(404).json({ error: "not found" });
      return;
    }

    // Prepare the turn (DB + memory recall + prompt) BEFORE switching to SSE,
    // so any failure here (DB error, missing/invalid OpenAI key, embedding call)
    // returns a clean JSON error instead of an opaque 500 mid-stream.
    let ai: AiClient;
    let system: string;
    let messages: ChatMessage[];
    let isFirstTurn = false;
    try {
      // 2. Load prior history BEFORE inserting the new user message
      const priorMessages = await prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { role: true, content: true },
      });

      isFirstTurn = priorMessages.length === 0;

      const priorHistory: ChatMessage[] = priorMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // 3. Insert the new user message (capture id for attachment linking)
      const userMessage = await prisma.message.create({
        data: { chatId, role: "user", content },
        select: { id: true },
      });

      // 3b. Link any uploaded images to this message and load them as data URLs
      let images: string[] = [];
      if (attachmentIds && attachmentIds.length > 0) {
        const atts = await prisma.attachment.findMany({
          where: { id: { in: attachmentIds }, userId: req.userId!, messageId: null },
        });
        if (atts.length > 0) {
          await prisma.attachment.updateMany({
            where: { id: { in: atts.map((a) => a.id) } },
            data: { messageId: userMessage.id },
          });
          images = atts
            .filter((a) => fs.existsSync(a.storedPath))
            .map((a) => `data:${a.mimeType};base64,${fs.readFileSync(a.storedPath).toString("base64")}`);
        }
      }

      ai = getAi();

      // 4. Search memories
      const facts = await searchMemories(ai, req.userId!, content, 5);

      // 5. Build prompt (with any attached images for vision)
      ({ system, messages } = buildPrompt({ facts, history: priorHistory, message: content, images }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to prepare turn";
      res.status(500).json({ error: message });
      return;
    }

    // 6. Set SSE headers and flush
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Stop streaming if the client disconnects mid-turn.
    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    // On the first turn, generate a ChatGPT-style title from the opening message,
    // overlapped with the response stream so it adds no perceived latency.
    // Best-effort: a title failure must never break the reply.
    const titlePromise = isFirstTurn
      ? generateChatTitle(ai, content).catch(() => null)
      : null;

    let full = "";

    try {
      for await (const chunk of ai.streamChat({ system, messages })) {
        if (aborted) break;
        full += chunk;
        res.write("data: " + JSON.stringify({ text: chunk }) + "\n\n");
      }

      // If the client went away, stop without writing to a dead socket.
      if (aborted) return;

      // 7. Save assistant message AFTER stream ends
      await prisma.message.create({
        data: { chatId, role: "assistant", content: full },
      });

      // Apply the generated title before signalling done, so the client's
      // chat-list refetch (triggered on "done") shows the new title.
      if (titlePromise) {
        const title = await titlePromise;
        if (title) await prisma.chat.update({ where: { id: chatId }, data: { title } });
      }

      res.write("event: done\ndata: {}\n\n");
      res.end();

      // 8. Fire-and-forget memory capture
      extractFacts(ai, content, full)
        .then((newFacts) => Promise.all(newFacts.map((f) => addMemory(ai, req.userId!, f))))
        .catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : "stream error";
      if (res.headersSent) {
        res.write("event: error\ndata: " + JSON.stringify({ error: message }) + "\n\n");
        res.end();
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  return router;
}
