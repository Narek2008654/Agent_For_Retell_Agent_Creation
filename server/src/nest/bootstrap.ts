import "reflect-metadata";
import express, { type RequestHandler } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter, type NestExpressApplication } from "@nestjs/platform-express";
import { env } from "../env.js";
import type { AiClient } from "../ai/client.js";
import type { RetellClient } from "../retell/client.js";
import type { TwilioClient } from "../twilio/client.js";
import type { BrevoClient } from "../brevo/client.js";
import { clerkAuth } from "../middleware/clerkAuth.js";
import "../middleware/requireAuth.js";
import { AppModule } from "./app.module.js";

export interface BootstrapOptions {
  ai?: AiClient;
  retell?: RetellClient;
  twilio?: TwilioClient;
  brevo?: BrevoClient;
  /** Override the auth guard (tests use fakeAuth). Defaults to clerkAuth. */
  requireAuth?: RequestHandler;
  /** Suppress Nest startup logs (tests). */
  silent?: boolean;
}

/**
 * Paths that require auth — the guard runs first and populates req.userId
 * before the Nest controllers handle the request. /api/health and
 * /api/retell/webhook are intentionally NOT here (the webhook is Retell, not
 * a Clerk user; health must work even without Clerk keys).
 */
const AUTH_PATHS = ["/api/chats", "/api/calls", "/api/memory", "/api/uploads", "/api/files"];

/**
 * Builds the full Nest+Express application: HTTP server, body parsers (Nest's
 * default), CORS, Clerk middleware (when no test override), and per-prefix auth
 * guards that populate req.userId for the Nest controllers. Used by index.ts
 * (then .listen()) and createTestServer (then .init()).
 */
export async function bootstrap(opts: BootstrapOptions = {}): Promise<NestExpressApplication> {
  const expressInstance = express();
  expressInstance.use(cors({ origin: env.CLIENT_URL }));
  if (!opts.requireAuth) expressInstance.use(clerkMiddleware());
  // Guards run only on the protected prefixes; webhook + health bypass the guard.
  const guard = opts.requireAuth ?? clerkAuth;
  for (const path of AUTH_PATHS) expressInstance.use(path, guard);

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ ai: opts.ai, retell: opts.retell, twilio: opts.twilio, brevo: opts.brevo }),
    new ExpressAdapter(expressInstance),
    opts.silent ? { logger: false } : {},
  );
  return app;
}
