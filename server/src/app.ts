import express, { type RequestHandler } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./env.js";
import "./middleware/requireAuth.js";
import { clerkAuth } from "./middleware/clerkAuth.js";
import type { AiClient } from "./ai/client.js";
import { createOpenAiClient } from "./ai/client.js";
import { createChatsRouter } from "./routes/chats.js";
import { createMemoryRouter } from "./routes/memory.js";
import { createUploadsRouter } from "./routes/uploads.js";
import { createFilesRouter } from "./routes/files.js";

export function createApp(opts: { ai?: AiClient; requireAuth?: RequestHandler } = {}) {
  let cachedReal: AiClient | undefined;

  function getAi(): AiClient {
    return opts.ai ?? (cachedReal ??= createOpenAiClient(env.OPENAI_API_KEY ?? ""));
  }

  const app = express();

  app.use(cors({ origin: env.CLIENT_URL }));

  // Health must be registered BEFORE Clerk middleware so it works without Clerk keys.
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Determine the auth guard to use.
  // When a custom requireAuth is injected (e.g. tests), skip clerkMiddleware entirely.
  const guard = opts.requireAuth ?? clerkAuth;
  if (!opts.requireAuth) {
    app.use(clerkMiddleware());
  }

  app.use(express.json());

  app.use("/api/chats", guard, createChatsRouter(getAi));
  app.use("/api/memory", guard, createMemoryRouter());
  app.use("/api/uploads", guard, createUploadsRouter());
  app.use("/api/files", guard, createFilesRouter());

  return app;
}
