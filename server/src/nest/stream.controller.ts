import fs from "node:fs";
import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import type { AiClient, ChatMessage } from "../ai/client.js";
import { buildPrompt } from "../chat/prompt.js";
import { generateChatTitle } from "../chat/title.js";
import { extractFacts } from "../memory/extract.js";
import { searchMemories, addMemory } from "../memory/store.js";
import { PrismaService } from "./prisma.service.js";
import { AI_CLIENT } from "./tokens.js";
import { UserId } from "./user-id.decorator.js";

const streamBodySchema = z.object({
  content: z.string().min(1),
  attachmentIds: z.array(z.string()).max(5).optional(),
});

/**
 * POST /api/chats/:id/stream — server-sent-events streaming turn.
 *
 * Keeps the bespoke "data: ...\n\nevent: done\ndata: {}\n\n" wire format the
 * client already parses; @Res() opt-in lets us write raw chunks instead of
 * going through Nest's Observable-based @Sse() (which would force a rewrite of
 * the client-side parser).
 */
@Controller("api/chats")
export class StreamController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AI_CLIENT) private readonly ai: AiClient,
  ) {}

  @Post(":id/stream")
  async stream(
    @UserId() userId: string,
    @Param("id") chatId: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = streamBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { content, attachmentIds } = parsed.data;

    const chat = await this.prisma.chat.findFirst({ where: { id: chatId, userId } });
    if (!chat) throw new NotFoundException();

    // Prepare the turn (DB + memory recall + prompt) BEFORE switching to SSE,
    // so any failure here returns clean JSON instead of an opaque mid-stream 500.
    let system: string;
    let messages: ChatMessage[];
    let isFirstTurn = false;
    try {
      const priorMessages = await this.prisma.message.findMany({
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

      const userMessage = await this.prisma.message.create({
        data: { chatId, role: "user", content },
        select: { id: true },
      });
      const images =
        attachmentIds && attachmentIds.length > 0
          ? await this.linkAttachmentsAsImages(attachmentIds, userId, userMessage.id)
          : [];

      const facts = await searchMemories(this.ai, userId, content, 5);
      ({ system, messages } = buildPrompt({ facts, history: priorHistory, message: content, images }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to prepare turn";
      res.status(500).json({ error: message });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    const titlePromise = isFirstTurn ? generateChatTitle(this.ai, content).catch(() => null) : null;

    let full = "";
    try {
      const reply = this.ai.chat({
        system,
        messages,
        chatId,
        lookupPerson: async (email) => {
          const p = await this.prisma.person.findUnique({
            where: { userId_email: { userId, email: email.trim().toLowerCase() } },
          });
          return p ? { name: p.name, background: p.background, summary: p.summary } : null;
        },
        saveAgentSettings: async (agentId, settings) => {
          await this.prisma.agentSettings.upsert({
            where: { agentId },
            create: {
              userId,
              agentId,
              noPickupSms: settings.noPickupSms,
              noPickupSmsFollowup: settings.noPickupSmsFollowup,
            },
            update: {
              noPickupSms: settings.noPickupSms,
              noPickupSmsFollowup: settings.noPickupSmsFollowup,
            },
          });
        },
      });

      for await (const chunk of reply) {
        if (aborted) break;
        full += chunk;
        res.write("data: " + JSON.stringify({ text: chunk }) + "\n\n");
      }
      if (aborted) return;

      await this.prisma.message.create({ data: { chatId, role: "assistant", content: full } });

      if (titlePromise) {
        const title = await titlePromise;
        if (title) await this.prisma.chat.update({ where: { id: chatId }, data: { title } });
      }

      res.write("event: done\ndata: {}\n\n");
      res.end();

      extractFacts(this.ai, content, full)
        .then((newFacts) => Promise.all(newFacts.map((f) => addMemory(this.ai, userId, f))))
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
  }

  /**
   * Link the user's unlinked attachments to a message and return them as base64
   * data URLs for the vision call. Ignores ids that aren't owned/unlinked.
   */
  private async linkAttachmentsAsImages(
    attachmentIds: string[],
    userId: string,
    messageId: string,
  ): Promise<string[]> {
    const atts = await this.prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, userId, messageId: null },
    });
    if (atts.length === 0) return [];
    await this.prisma.attachment.updateMany({
      where: { id: { in: atts.map((a) => a.id) } },
      data: { messageId },
    });
    return atts
      .filter((a) => fs.existsSync(a.storedPath))
      .map((a) => `data:${a.mimeType};base64,${fs.readFileSync(a.storedPath).toString("base64")}`);
  }
}
