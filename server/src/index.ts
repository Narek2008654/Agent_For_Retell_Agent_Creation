import { env } from "./env.js";
import { createOpenAiClient } from "./ai/client.js";
import { createRetellClient } from "./retell/client.js";
import { createTwilioClient } from "./twilio/client.js";
import { reconcileMissedCalls } from "./retell/reconcile.js";
import { bootstrap } from "./nest/bootstrap.js";

// Build the live clients once and share them with both the Nest app and the
// background reconciler — avoids opening duplicate connections.
const retell = createRetellClient(env.RETELL_API_KEY ?? "", { webhookUrl: env.RETELL_WEBHOOK_URL });
const ai = createOpenAiClient(env.OPENAI_API_KEY ?? "", retell);
const twilio = createTwilioClient(env.TWILIO_ACCOUNT_SID ?? "", env.TWILIO_AUTH_TOKEN ?? "");

const app = await bootstrap({ ai, retell, twilio });
// Run Nest lifecycle hooks (incl. PrismaService disconnect) on process signals
// so the shared DB pool is torn down cleanly on SIGTERM/SIGINT.
app.enableShutdownHooks();
await app.listen(env.PORT);
console.log(`Server listening on http://localhost:${env.PORT}`);

// Recover from missed webhook deliveries (ngrok blips, restarts, older agents
// with no webhook_url): periodically reconcile against Retell's call list and
// replay anything we don't already have. Runs once shortly after startup, then
// every RECONCILE_INTERVAL_MS.
const RECONCILE_INTERVAL_MS = 5 * 60_000;

// Skip a tick while the previous one is still running so a slow reconcile
// (many calls to replay) can't pile up overlapping passes against the same DB.
let reconciling = false;

async function tickReconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const r = await reconcileMissedCalls({ ai, twilio });
    if (r.replayed > 0) console.log(`[reconcile] replayed ${r.replayed} of ${r.checked} recent calls`);
  } catch (err) {
    console.error("[reconcile] failed:", err instanceof Error ? err.message : err);
  } finally {
    reconciling = false;
  }
}

setTimeout(tickReconcile, 10_000);
setInterval(tickReconcile, RECONCILE_INTERVAL_MS);
