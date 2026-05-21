import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AiClient } from "../ai/client.js";
import { searchMemories, addMemory } from "../memory/store.js";
import { buildPrompt } from "../chat/prompt.js";
import { extractFacts } from "../memory/extract.js";
import type { ChatMessage } from "../ai/client.js";

const streamBodySchema = z.object({
  content: z.string().min(1),
});

export function createStreamRouter(getAi: () => AiClient): Router {
  const router = Router();

  // POST /:id/stream — SSE streaming turn
  router.post("/:id/stream", requireAuth, async (req, res) => {
    const parsed = streamBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { content } = parsed.data;
    const chatId = req.params.id as string;

    // 1. Verify the chat exists and is owned by the user
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId: req.user!.id },
    });

    if (!chat) {
      res.status(404).json({ error: "not found" });
      return;
    }

    // 2. Load prior history BEFORE inserting the new user message
    const priorMessages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { role: true, content: true },
    });

    const priorHistory: ChatMessage[] = priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // 3. Insert the new user message
    await prisma.message.create({
      data: { chatId, role: "user", content },
    });

    const ai = getAi();

    // 4. Search memories
    const facts = await searchMemories(ai, req.user!.id, content, 5);

    // 5. Build prompt
    const { system, messages } = buildPrompt({ facts, history: priorHistory, message: content });

    // 6. Set SSE headers and flush
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let full = "";

    try {
      for await (const chunk of ai.streamChat({ system, messages })) {
        full += chunk;
        res.write("data: " + JSON.stringify({ text: chunk }) + "\n\n");
      }

      // 7. Save assistant message AFTER stream ends
      await prisma.message.create({
        data: { chatId, role: "assistant", content: full },
      });

      res.write("event: done\ndata: {}\n\n");
      res.end();

      // 8. Fire-and-forget memory capture
      extractFacts(ai, content, full)
        .then((fs) => Promise.all(fs.map((f) => addMemory(ai, req.user!.id, f))))
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
