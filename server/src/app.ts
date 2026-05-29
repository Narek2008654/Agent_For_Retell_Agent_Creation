import express, { type RequestHandler } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./env.js";
import "./middleware/requireAuth.js";
import { clerkAuth } from "./middleware/clerkAuth.js";
import type { AiClient } from "./ai/client.js";
import type { RetellClient } from "./retell/client.js";
import type { TwilioClient } from "./twilio/client.js";

/**
 * Builds the underlying Express instance: CORS, auth middleware, health check,
 * the JSON body parser, and path-scoped guards that populate req.userId before
 * the Nest controllers run. Route handlers themselves live in src/nest/*.
 *
 * The injectable opts (ai/retell/twilio) are not consumed here — they're
 * threaded through createTestServer / index.ts into the Nest DynamicModule.
 */
export function createApp(
  _opts: { ai?: AiClient; retell?: RetellClient; twilio?: TwilioClient; requireAuth?: RequestHandler } = {},
) {
  const app = express();

  app.use(cors({ origin: env.CLIENT_URL }));

  // Health must be registered BEFORE Clerk middleware so it works without Clerk keys.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Retell webhook is served by the Nest WebhookController; nothing to mount
  // here. It stays outside the auth chain because Retell isn't a Clerk user.

  // Determine the auth guard to use. When a custom requireAuth is injected
  // (tests), skip clerkMiddleware entirely.
  const guard = _opts.requireAuth ?? clerkAuth;
  if (!_opts.requireAuth) {
    app.use(clerkMiddleware());
  }

  app.use(express.json());

  // Each /api/* prefix gets the guard so req.userId is populated before the
  // Nest controllers handle the request.
  app.use("/api/chats", guard);
  app.use("/api/calls", guard);
  app.use("/api/memory", guard);
  app.use("/api/uploads", guard);
  app.use("/api/files", guard);

  return app;
}
