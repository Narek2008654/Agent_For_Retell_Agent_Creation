import { prisma } from "../db.js";
import { env } from "../env.js";
import type { AiClient } from "../ai/client.js";
import type { TwilioClient } from "../twilio/client.js";
import { handleCallEnded } from "../routes/webhook.js";

const RETELL_BASE = "https://api.retellai.com";

interface ReconcileDeps {
  ai: AiClient;
  twilio: TwilioClient;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
}

interface ReconcileResult {
  checked: number;
  replayed: number;
}

/**
 * Pulls recent Retell calls and replays any our DB is missing through the same
 * handler the live webhook uses. Defends against transient webhook delivery gaps
 * (ngrok blips, brief server downtime, missing webhook_url on older agents).
 * Idempotent: handleCallEnded skips calls whose id is already in the DB.
 */
export async function reconcileMissedCalls(deps: ReconcileDeps): Promise<ReconcileResult> {
  const apiKey = env.RETELL_API_KEY;
  if (!apiKey) return { checked: 0, replayed: 0 };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  const listRes = await fetchImpl(`${RETELL_BASE}/v3/list-calls`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sort_order: "descending", limit: 50 }),
  });
  if (!listRes.ok) return { checked: 0, replayed: 0 };
  const listBody = (await listRes.json()) as unknown;
  const items = (Array.isArray(listBody)
    ? listBody
    : ((listBody as { items?: unknown[] })?.items ?? [])) as Array<Record<string, unknown>>;

  let replayed = 0;
  for (const item of items) {
    const callId = item["call_id"];
    if (typeof callId !== "string") continue;
    if (await prisma.call.findUnique({ where: { id: callId } })) continue;

    // list-calls omits the transcript field; fetch the full payload before replay.
    const getRes = await fetchImpl(`${RETELL_BASE}/v2/get-call/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!getRes.ok) continue;
    const fullCall = (await getRes.json()) as Record<string, unknown>;
    await handleCallEnded(deps.ai, deps.twilio, { event: "call_ended", call: fullCall });
    replayed += 1;
  }

  return { checked: items.length, replayed };
}
