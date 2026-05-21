import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AiClient } from "../ai/client.js";
import { createStreamRouter } from "./stream.js";

const createChatSchema = z.object({
  title: z.string().default("New chat"),
});

export function createChatsRouter(getAi: () => AiClient): Router {
  const router = Router();

  // All routes require authentication
  router.use(requireAuth);

  // POST / — create a chat
  router.post("/", async (req, res) => {
    const parsed = createChatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { title } = parsed.data;
    const chat = await prisma.chat.create({
      data: {
        userId: req.user!.id,
        title,
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(chat);
  });

  // GET / — list user's chats, newest first
  router.get("/", async (req, res) => {
    const chats = await prisma.chat.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(chats);
  });

  // GET /:id — return a single chat if owned
  router.get("/:id", async (req, res) => {
    const chat = await prisma.chat.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!chat) {
      res.status(404).json({ error: "not found" });
      return;
    }

    res.json(chat);
  });

  // DELETE /:id — delete if owned (owner-scoped, atomic)
  router.delete("/:id", async (req, res) => {
    const { count } = await prisma.chat.deleteMany({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (count === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }

    res.json({ ok: true });
  });

  // GET /:id/messages — return messages for owned chat
  router.get("/:id/messages", async (req, res) => {
    const chat = await prisma.chat.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!chat) {
      res.status(404).json({ error: "not found" });
      return;
    }

    const messages = await prisma.message.findMany({
      where: { chatId: req.params.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        chatId: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    res.json(messages);
  });

  // Mount the stream router — POST /:id/stream
  router.use(createStreamRouter(getAi));

  return router;
}
