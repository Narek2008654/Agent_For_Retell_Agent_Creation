import express, { type RequestHandler } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./env.js";
import "./middleware/requireAuth.js";
import { clerkAuth } from "./middleware/clerkAuth.js";
import type { AiClient } from "./ai/client.js";
import { createOpenAiClient } from "./ai/client.js";
import type { RetellClient } from "./retell/client.js";
import { createRetellClient } from "./retell/client.js";
import type { TwilioClient } from "./twilio/client.js";
import { createTwilioClient } from "./twilio/client.js";
import { createChatsRouter } from "./routes/chats.js";
import { createMemoryRouter } from "./routes/memory.js";
import { createUploadsRouter } from "./routes/uploads.js";
import { createFilesRouter } from "./routes/files.js";
import { createWebhookRouter } from "./routes/webhook.js";
import { createCallsRouter } from "./routes/calls.js";

export function createApp(
  opts: { ai?: AiClient; retell?: RetellClient; twilio?: TwilioClient; requireAuth?: RequestHandler } = {},
) {
  let cachedAi: AiClient | undefined;
  let cachedRetell: RetellClient | undefined;
  let cachedTwilio: TwilioClient | undefined;

  function getAi(): AiClient {
    return opts.ai ?? (cachedAi ??= createOpenAiClient(env.OPENAI_API_KEY ?? "", getRetell()));
  }

  function getRetell(): RetellClient {
    return (
      opts.retell ??
      (cachedRetell ??= createRetellClient(env.RETELL_API_KEY ?? "", {
        webhookUrl: env.RETELL_WEBHOOK_URL,
      }))
    );
  }

  function getTwilio(): TwilioClient {
    return (
      opts.twilio ??
      (cachedTwilio ??= createTwilioClient(env.TWILIO_ACCOUNT_SID ?? "", env.TWILIO_AUTH_TOKEN ?? ""))
    );
  }

  const app = express();

  app.use(cors({ origin: env.CLIENT_URL }));

  // Health must be registered BEFORE Clerk middleware so it works without Clerk keys.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Retell webhook: posted by Retell (not a Clerk user), so mount it before the
  // auth guard with its own JSON parser.
  app.use("/api/retell/webhook", express.json(), createWebhookRouter(getAi, getTwilio));

  // Determine the auth guard to use.
  // When a custom requireAuth is injected (e.g. tests), skip clerkMiddleware entirely.
  const guard = opts.requireAuth ?? clerkAuth;
  if (!opts.requireAuth) {
    app.use(clerkMiddleware());
  }

  app.use(express.json());

  app.use("/api/chats", guard, createChatsRouter(getAi));
  app.use("/api/calls", guard, createCallsRouter());
  app.use("/api/memory", guard, createMemoryRouter());
  app.use("/api/uploads", guard, createUploadsRouter());
  app.use("/api/files", guard, createFilesRouter());

  return app;
}
