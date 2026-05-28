import { Router } from "express";
import { prisma } from "../db.js";
import { env } from "../env.js";
import type { AiClient } from "../ai/client.js";
import type { TwilioClient } from "../twilio/client.js";

/** Disconnection reasons that mean the call never reached a real person → send the no-pickup SMS. */
const NO_PICKUP_REASONS = new Set([
  "dial_failed",
  "dial_no_answer",
  "no_answer",
  "dial_busy",
  "voicemail_reached",
]);

/**
 * True when the user never actually said anything meaningful — e.g. they
 * declined the call and the agent spoke into voicemail/silence. Treats lines
 * like "User: (inaudible speech)" as nothing.
 */
function userSaidSomething(transcript: string): boolean {
  const userText = transcript
    .split("\n")
    .filter((line) => /^\s*user\s*:/i.test(line))
    .map((line) => line.replace(/^\s*user\s*:\s*/i, "").replace(/\(inaudible[^)]*\)/gi, "").trim())
    .join(" ");
  return userText.split(/\s+/).filter(Boolean).length > 0;
}

/** Replace {{key}} tokens in a template with values from a vars object. */
function fillTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

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

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A concise summary of one call's transcript (or a note that it didn't connect). */
async function summarizeCall(ai: AiClient, transcript: string): Promise<string> {
  if (!transcript) return "No conversation took place — the call didn't connect.";
  return ai.complete(
    "Summarize this phone call transcript in 2-3 sentences for the person who asked for the call. " +
      "Be concise and factual.\n\nTranscript:\n" +
      transcript,
  );
}

/**
 * Upsert the person (by email) and fold this call's summary into their rolling
 * engagement summary. Returns the person id.
 */
async function rollUpPerson(
  ai: AiClient,
  userId: string,
  email: string,
  callSummary: string,
  name: string | null,
  background: string,
): Promise<string> {
  const existing = await prisma.person.findUnique({ where: { userId_email: { userId, email } } });
  if (!existing) {
    const created = await prisma.person.create({
      data: { userId, email, summary: callSummary, name, background },
    });
    return created.id;
  }

  const merged = await ai.complete(
    "Update a contact's engagement summary to incorporate a new call. Keep it a few factual sentences.\n\n" +
      `Existing summary:\n${existing.summary}\n\nLatest call summary:\n${callSummary}`,
  );
  await prisma.person.update({
    where: { id: existing.id },
    data: {
      summary: merged,
      // Keep what we already have; otherwise adopt the newly provided value.
      name: existing.name ?? name,
      background: existing.background || background,
    },
  });
  return existing.id;
}

/**
 * Handle a Retell "call_ended" webhook: log the full call, roll its summary into
 * the person identified by metadata.email, and post a short note into the chat
 * that placed it. The chat id and email are carried in call.metadata (set when
 * we placed the call). Other events and unattributable calls are ignored.
 * Idempotent: a repeated webhook for the same call_id is a no-op.
 */
/**
 * If the call didn't reach a real person and the agent has a configured
 * no-pickup SMS template, send it via Twilio. Best-effort: failures are caught
 * by the surrounding handler and don't break webhook acknowledgement.
 */
async function maybeSendNoPickupSms(
  twilio: TwilioClient,
  call: Record<string, unknown>,
  reason: string,
): Promise<void> {
  // Send when Retell reports a no-pickup reason OR when nothing real was said
  // (e.g. the user declined and the agent talked into silence/voicemail).
  const transcript = asString(call["transcript"])?.trim() ?? "";
  const noRealConversation = !userSaidSomething(transcript);
  if (!NO_PICKUP_REASONS.has(reason) && !noRealConversation) return;
  const agentId = asString(call["agent_id"]);
  const toNumber = asString(call["to_number"]);
  if (!agentId || !toNumber) return;

  const settings = await prisma.agentSettings.findUnique({ where: { agentId } });
  if (!settings) return;

  const vars = (call["retell_llm_dynamic_variables"] as Record<string, unknown>) ?? {};
  // Returning contact (we already know about them) → use the followup template
  // when one is set; first interaction → use the asks-if-interested template.
  const isReturning = !!asString(vars["caller_context"])?.trim();
  const template =
    (isReturning && settings.noPickupSmsFollowup) || settings.noPickupSms || settings.noPickupSmsFollowup;
  if (!template) return;
  const body = fillTemplate(template, vars).trim();
  if (!body) return;

  const from = asString(call["from_number"]) ?? env.RETELL_FROM_NUMBER;
  if (!from) return;

  await twilio.sendSms({ from, to: toNumber, body });
}

async function handleCallEnded(ai: AiClient, twilio: TwilioClient, body: unknown): Promise<void> {
  const payload = body as { event?: string; call?: Record<string, unknown> };
  const call = payload.call;
  if (payload.event !== "call_ended" || !call) return;

  const callId = asString(call["call_id"]);
  const metadata = call["metadata"] as Record<string, unknown> | undefined;
  const chatId = metadata?.["chatId"];
  if (!callId || typeof chatId !== "string") return;

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) return;

  // A repeated webhook for the same call must not double-log or double-roll-up.
  if (await prisma.call.findUnique({ where: { id: callId } })) return;

  const seconds = durationSeconds(call["start_timestamp"], call["end_timestamp"]);
  const reason = asString(call["disconnection_reason"]) ?? "unknown";
  const transcript = asString(call["transcript"])?.trim() ?? "";
  const emailRaw = metadata?.["email"];
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  const name = asString(metadata?.["name"]);
  const background = asString(metadata?.["background"]) ?? "";

  // Log the call FIRST, so it's saved no matter how it ended (declined,
  // dial_failed, no answer) and even if summarizing / person rollup below fails.
  await prisma.call.create({
    data: {
      id: callId,
      userId: chat.userId,
      chatId,
      fromNumber: asString(call["from_number"]),
      toNumber: asString(call["to_number"]),
      agentId: asString(call["agent_id"]),
      status: asString(call["call_status"]),
      disconnectionReason: reason,
      durationSec: seconds,
      transcript,
      personEmail: email || null,
    },
  });

  // Enrich: summarize and fold into the person's rolling engagement summary.
  const summary = await summarizeCall(ai, transcript);
  const personId = email ? await rollUpPerson(ai, chat.userId, email, summary, name, background) : null;
  await prisma.call.update({ where: { id: callId }, data: { summary, personId } });

  // Notify the chat that placed the call.
  const content = [
    "Your call has ended.",
    `• Duration: ${formatDuration(seconds)}`,
    `• How it ended: ${reason}`,
    `• Summary: ${summary}`,
  ].join("\n");
  await prisma.message.create({ data: { chatId, role: "assistant", content } });

  // If the call didn't reach a real person, fire the no-pickup SMS (best-effort).
  await maybeSendNoPickupSms(twilio, call, reason).catch(() => {});
}

export function createWebhookRouter(getAi: () => AiClient, getTwilio: () => TwilioClient): Router {
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
      await handleCallEnded(getAi(), getTwilio(), req.body);
    } catch {
      // best-effort: swallow and still acknowledge
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
