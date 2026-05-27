import { Router } from "express";
import { prisma } from "../db.js";
import { env } from "../env.js";
import type { AiClient } from "../ai/client.js";

/** Seconds between two epoch-millisecond timestamps (0 if missing/invalid). */
function durationSeconds(start: unknown, end: unknown): number {
  const s = Number(start);
  const e = Number(end);
  if (!s || !e || e < s) return 0;
  return Math.round((e - s) / 1000);
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Handle a Retell "call_ended" webhook: summarize the call and post it as an
 * assistant message in the chat that started it (the chat id is carried in
 * call.metadata, set when we placed the call). Other events, and calls we can't
 * attribute to an existing chat, are ignored.
 */
async function handleCallEnded(ai: AiClient, body: unknown): Promise<void> {
  const payload = body as { event?: string; call?: Record<string, unknown> };
  const call = payload.call;
  if (payload.event !== "call_ended" || !call) return;

  const metadata = call["metadata"] as Record<string, unknown> | undefined;
  const chatId = metadata?.["chatId"];
  if (typeof chatId !== "string") return;

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) return;

  const seconds = durationSeconds(call["start_timestamp"], call["end_timestamp"]);
  const reason = typeof call["disconnection_reason"] === "string" ? call["disconnection_reason"] : "unknown";
  const transcript = typeof call["transcript"] === "string" ? call["transcript"].trim() : "";

  const summary = transcript
    ? await ai.complete(
        "Summarize this phone call transcript in 2-3 sentences for the person who asked for the call. " +
          "Be concise and factual.\n\nTranscript:\n" +
          transcript,
      )
    : "No conversation took place — the call didn't connect.";

  const content = [
    "Your call has ended.",
    `• Duration: ${formatDuration(seconds)}`,
    `• How it ended: ${reason}`,
    `• Summary: ${summary}`,
  ].join("\n");

  await prisma.message.create({ data: { chatId, role: "assistant", content } });
}

export function createWebhookRouter(getAi: () => AiClient): Router {
  const router = Router();

  // POST / — Retell posts call lifecycle events here. Not Clerk-authenticated
  // (Retell isn't a user); guarded by an optional shared secret in the query.
  router.post("/", async (req, res) => {
    if (env.RETELL_WEBHOOK_SECRET && req.query.secret !== env.RETELL_WEBHOOK_SECRET) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    // Always ack with 2xx — a failure on our side must not trigger Retell retries.
    try {
      await handleCallEnded(getAi(), req.body);
    } catch {
      // best-effort: swallow and still acknowledge
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
