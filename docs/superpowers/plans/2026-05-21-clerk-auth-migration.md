# Clerk Auth Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Better Auth (self-hosted email/password) with Clerk (hosted identity); scope data by Clerk user ID; use Clerk's prebuilt React components; authenticate the API with Clerk bearer tokens.

**Architecture:** Clerk is the source of truth for users. Backend protects routes with an injectable guard (Clerk in prod, a header-based fake in tests) that sets `req.userId`. Frontend wraps the app in `<ClerkProvider>`, uses `<SignIn/>`/`<SignUp/>`/`<UserButton/>`/`<SignedIn>`, and attaches `Authorization: Bearer <clerk token>` to API calls. The chat/streaming/memory/title logic is unchanged.

**Tech Stack:** `@clerk/express`, `@clerk/clerk-react`, Express, Prisma/Postgres+pgvector, Vite/React, Vitest.

---

## Conventions
- Backend tests: `npm test -w server` (Vitest + supertest, Docker Postgres running). Frontend: `npm test -w client`.
- Each task must leave both builds green (the auth swap is interdependent, hence large cohesive tasks).
- Tests never call real Clerk: backend injects a fake header guard; frontend mocks `@clerk/clerk-react`.

## File map
- **Backend changed:** `server/package.json`, `server/src/env.ts`, `server/src/app.ts`, `server/src/routes/{chats,stream,memory}.ts`, `server/src/middleware/requireAuth.ts` (repurposed), tests in `server/src/__tests__/*`. **Deleted:** `server/src/auth.ts`. **New:** `server/src/middleware/clerkAuth.ts`, `server/src/test/fakeAuth.ts`, Prisma migration.
- **Frontend changed:** `client/package.json`, `client/src/main.tsx`, `client/src/lib/{api.ts,streamChat.ts}`, `client/src/pages/{Chat,Login,Signup}.tsx`, `client/src/components/{AppHeader,ChatSidebar,MessageList? (no),Memory page}`, tests. **New:** `client/src/lib/useApi.ts`. **Deleted:** `client/src/lib/authClient.ts`, `client/src/components/ProtectedRoute.tsx`.

---

## Task 1: Backend — swap Better Auth for Clerk

**Files:** see below. Goal: `npm test -w server` green; `npx tsc --noEmit` clean; app boots without Clerk keys (tests inject the fake guard).

### 1a. Dependencies + env
- [ ] `server/package.json`: remove `better-auth`; add `@clerk/express` (`^1.3.0` or latest). Run `npm install` at root.
- [ ] `server/src/env.ts`: remove `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`; add `CLERK_SECRET_KEY: z.string().optional()` and `CLERK_PUBLISHABLE_KEY: z.string().optional()` (optional so tests/import don't require them). Keep `DATABASE_URL`, `CLIENT_URL`, `OPENAI_API_KEY`, `CHAT_MODEL`, `EMBEDDING_MODEL`, `PORT`, `NODE_ENV`.

### 1b. Prisma migration (drop auth tables, userId → plain String)
- [ ] Edit `server/prisma/schema.prisma`:
  - Delete the `User`, `Session`, `Account`, `Verification` models.
  - In `Chat`: remove the `user User @relation(...)` field; keep `userId String` (no relation).
  - In `Memory`: remove the `user User @relation(...)` field; keep `userId String` (no relation).
- [ ] Create the migration: `cd server && npx prisma migrate dev --name clerk_drop_user_tables`. Confirm it drops the 4 tables and the FKs, and applies cleanly. (The pgvector `embedding` column + index on `Memory` are untouched — verify they survive with `\d "Memory"`.)
- [ ] `npx prisma generate`.

### 1c. Clerk guard + injectable auth + Request type
- [ ] Create `server/src/middleware/clerkAuth.ts`:

```ts
import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";

/** Production guard: requires a valid Clerk session; sets req.userId. */
export const clerkAuth: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.userId = userId;
  next();
};
```

- [ ] Repurpose `server/src/middleware/requireAuth.ts` to ONLY hold the Express type augmentation (remove the old Better Auth logic):

```ts
// Express Request augmentation: the auth guard populates req.userId.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
```

- [ ] Create `server/src/test/fakeAuth.ts` (used by tests to avoid real Clerk):

```ts
import type { RequestHandler } from "express";

/** Test guard: authenticates via the `x-test-user-id` header. */
export const fakeAuth: RequestHandler = (req, res, next) => {
  const userId = req.header("x-test-user-id");
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.userId = userId;
  next();
};
```

- [ ] Delete `server/src/auth.ts`.

### 1d. Wire createApp + routes
- [ ] `server/src/app.ts`: rewrite the factory. Remove the Better Auth handler mount, remove `GET /api/me`. Accept an injectable guard:

```ts
import express, { type RequestHandler } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./env.js";
import "./middleware/requireAuth.js"; // loads the Request augmentation
import { clerkAuth } from "./middleware/clerkAuth.js";
import { createChatsRouter } from "./routes/chats.js";
import { createMemoryRouter } from "./routes/memory.js";
import { createOpenAiClient, type AiClient } from "./ai/client.js";

export function createApp(opts: { ai?: AiClient; requireAuth?: RequestHandler } = {}) {
  const app = express();
  app.use(cors({ origin: env.CLIENT_URL }));

  // Real Clerk auth attaches to every request unless a test guard is injected.
  if (!opts.requireAuth) app.use(clerkMiddleware());
  const guard: RequestHandler = opts.requireAuth ?? clerkAuth;

  app.use(express.json());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  let cachedAi: AiClient | undefined;
  const getAi = (): AiClient => (opts.ai ?? (cachedAi ??= createOpenAiClient(env.OPENAI_API_KEY ?? "")));

  app.use("/api/chats", guard, createChatsRouter(getAi));
  app.use("/api/memory", guard, createMemoryRouter());
  return app;
}
```

- [ ] `server/src/routes/chats.ts`: remove `router.use(requireAuth)` and the `requireAuth` import (the guard is applied by `createApp`). Replace every `req.user!.id` with `req.userId!`. (The stream sub-router is still mounted via `router.use(createStreamRouter(getAi))` and is covered by the `/api/chats` guard.)
- [ ] `server/src/routes/stream.ts`: replace every `req.user!.id` with `req.userId!`.
- [ ] `server/src/routes/memory.ts`: remove any internal `requireAuth` usage/import; export `createMemoryRouter()` (a factory returning the router) if it isn't already a factory; replace `req.user!.id` with `req.userId!`. (If `memory.ts` currently exports a ready router rather than a factory, convert it to `export function createMemoryRouter(): Router`.)

### 1e. Rewrite backend tests (inject fakeAuth, authenticate via header)
- [ ] Delete `server/src/__tests__/auth.test.ts`; create `server/src/__tests__/guard.test.ts`:

```ts
import request from "supertest";
import { createApp } from "../app.js";
import { fakeAuth } from "../test/fakeAuth.js";
import { createFakeAi } from "../ai/fakeAi.js";

const app = createApp({ ai: createFakeAi(), requireAuth: fakeAuth });

test("protected route returns 401 without an auth header", async () => {
  const res = await request(app).get("/api/chats");
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: "unauthorized" });
});

test("protected route passes with x-test-user-id", async () => {
  const res = await request(app).get("/api/chats").set("x-test-user-id", "user_abc");
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});
```

- [ ] `server/src/__tests__/chats.test.ts`, `stream.test.ts`, `memory.route.test.ts`: replace the Better Auth signup/cookie helpers with header auth. Build the app as `createApp({ ai: createFakeAi(), requireAuth: fakeAuth })`. Authenticate each request with `.set("x-test-user-id", USER1)`; prove per-user scoping by using a different id (`USER2`) for the cross-user 404 cases. Use string user ids like `"user_test_1"`/`"user_test_2"`. Cleanup: since `userId` is now a free string with no FK, clean up created rows by deleting chats/memories for the test user ids (e.g. `prisma.chat.deleteMany({ where: { userId: { in: [USER1, USER2] } } })`, `prisma.memory.deleteMany({ where: { userId: { in: [...] } } })`) in `beforeAll`/`afterAll`; `prisma.$disconnect()` in `afterAll`. Keep all behavioral assertions (2 messages after a turn, title generation, ownership 404, memory list/delete) identical.

### 1f. Verify + commit
- [ ] `npm test -w server` → all suites pass. `cd server && npx tsc --noEmit` → clean.
- [ ] Commit: `feat(server): replace Better Auth with Clerk (injectable guard, userId scoping)`.

---

## Task 2: Frontend — Clerk provider, components, and bearer-token API

**Files:** see below. Goal: `npm test -w client` green; `npx tsc -b --noEmit` clean; `npm run build -w client` succeeds.

### 2a. Dependencies + env
- [ ] `client/package.json`: remove `better-auth`; add `@clerk/clerk-react` (latest). `npm install` at root.
- [ ] `client/.env`: add `VITE_CLERK_PUBLISHABLE_KEY=` (placeholder; user fills in). Confirm `.env` stays gitignored.

### 2b. API token plumbing
- [ ] `client/src/lib/api.ts`: change `request` and helpers to take a token and send it as a bearer header; drop `credentials:"include"`.

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Chat { id: string; title: string; createdAt: string; updatedAt: string }
export interface Message { id: string; chatId: string; role: "user" | "assistant"; content: string; createdAt: string }
export interface Memory { id: string; content: string; createdAt: string }

async function request<T>(path: string, token: string | null, options?: RequestInit): Promise<T> {
  const { headers: callerHeaders, ...rest } = options ?? {};
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(callerHeaders as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export const getChats = (token: string | null) => request<Chat[]>("/api/chats", token);
export const createChat = (token: string | null, title?: string) =>
  request<Chat>("/api/chats", token, { method: "POST", body: JSON.stringify(title ? { title } : {}) });
export const deleteChat = (token: string | null, id: string) =>
  request<{ ok: true }>(`/api/chats/${id}`, token, { method: "DELETE" });
export const getMessages = (token: string | null, chatId: string) =>
  request<Message[]>(`/api/chats/${chatId}/messages`, token);
export const getMemories = (token: string | null) => request<Memory[]>("/api/memory", token);
export const deleteMemory = (token: string | null, id: string) =>
  request<{ ok: true }>(`/api/memory/${id}`, token, { method: "DELETE" });
```

- [ ] Create `client/src/lib/useApi.ts` (binds the current Clerk token to the helpers):

```ts
import { useAuth } from "@clerk/clerk-react";
import { useMemo } from "react";
import * as api from "./api";

export function useApi() {
  const { getToken } = useAuth();
  return useMemo(
    () => ({
      getChats: async () => api.getChats(await getToken()),
      createChat: async (title?: string) => api.createChat(await getToken(), title),
      deleteChat: async (id: string) => api.deleteChat(await getToken(), id),
      getMessages: async (chatId: string) => api.getMessages(await getToken(), chatId),
      getMemories: async () => api.getMemories(await getToken()),
      deleteMemory: async (id: string) => api.deleteMemory(await getToken(), id),
    }),
    [getToken]
  );
}
```

- [ ] `client/src/lib/streamChat.ts`: add a `token` parameter; send the bearer header; drop `credentials:"include"`. Signature becomes `streamChat(chatId, content, token, handlers)`:

```ts
const res = await fetch(`${API_URL}/api/chats/${chatId}/stream`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify({ content }),
});
```
Keep the existing SSE parsing (`\n\n` framing, `done`/`error`/chunk events, reader `finally` cancel) exactly as-is.

### 2c. Clerk provider, routing, pages, gating
- [ ] Delete `client/src/lib/authClient.ts` and `client/src/components/ProtectedRoute.tsx`.
- [ ] `client/src/pages/Login.tsx` → render Clerk SignIn:

```tsx
import { SignIn } from "@clerk/clerk-react";

export function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn routing="path" path="/login" signUpUrl="/signup" forceRedirectUrl="/" />
    </div>
  );
}
```

- [ ] `client/src/pages/Signup.tsx` → render Clerk SignUp:

```tsx
import { SignUp } from "@clerk/clerk-react";

export function Signup() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp routing="path" path="/signup" signInUrl="/login" forceRedirectUrl="/" />
    </div>
  );
}
```

- [ ] `client/src/main.tsx`: wrap in `<ClerkProvider>`, add a `Protected` gate, use catch-all paths for the Clerk component routes:

```tsx
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";
// ...QueryClientProvider, BrowserRouter, Routes, Route, Toaster, pages...

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut><RedirectToSignIn /></SignedOut>
    </>
  );
}

// <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
//   <QueryClientProvider client={queryClient}>
//     <BrowserRouter>
//       <Routes>
//         <Route path="/login/*" element={<Login />} />
//         <Route path="/signup/*" element={<Signup />} />
//         <Route path="/" element={<Protected><Chat /></Protected>} />
//         <Route path="/memory" element={<Protected><Memory /></Protected>} />
//       </Routes>
//     </BrowserRouter>
//     <Toaster />
//   </QueryClientProvider>
// </ClerkProvider>
```
(The `/login/*` and `/signup/*` catch-alls are required by Clerk's `routing="path"`.)

### 2d. AppHeader → UserButton; wire components to useApi + token
- [ ] `client/src/components/AppHeader.tsx`: remove the custom avatar `DropdownMenu`, `useSession`, `signOut`, and the sign-out handler. Render Clerk's `<UserButton />` (with `afterSignOutUrl="/login"`). Keep the app title and the `navLink`.
- [ ] `client/src/components/ChatSidebar.tsx`: use `const api = useApi();` and call `api.getChats/createChat/deleteChat` in the query/mutations.
- [ ] `client/src/pages/Memory.tsx`: use `const api = useApi();` for `getMemories`/`deleteMemory`.
- [ ] `client/src/pages/Chat.tsx`: use `const api = useApi()` for `getMessages`/`createChat`; obtain a token via `const { getToken } = useAuth()` and call `await streamChat(activeChatId, text, await getToken(), {...})`. Keep all streaming/optimistic logic identical.

### 2e. Tests
- [ ] Delete `client/src/pages/__tests__/Signup.test.tsx` and `client/src/components/__tests__/ProtectedRoute.test.tsx` (those components are gone).
- [ ] `client/src/lib/__tests__/streamChat.test.ts`: update calls to pass a token arg (e.g. `"test-token"`); add an assertion that `fetch` was called with an `Authorization: Bearer test-token` header. Keep the existing chunk/done/split/error assertions.
- [ ] `client/src/components/__tests__/AppHeader.test.tsx`: mock `@clerk/clerk-react` so `UserButton` is a stub (e.g. `() => <div>user-button</div>`); render `AppHeader` in a `MemoryRouter`; assert the title, the nav link, and the `user-button` stub render (no crash).
- [ ] Add `client/src/lib/__tests__/useApi.test.tsx`: mock `@clerk/clerk-react`'s `useAuth` to return `{ getToken: async () => "tok" }` and mock `../api`; render a tiny component (or use `renderHook`) that calls `useApi().getChats()`; assert `api.getChats` was called with `"tok"`.

### 2f. Verify + commit
- [ ] `npm test -w client` → all pass. `cd client && npx tsc -b --noEmit` → clean. `npm run build -w client` → succeeds.
- [ ] Commit: `feat(client): Clerk provider, prebuilt auth UI, bearer-token API`.

---

## Task 3: Docs, env example, and full verification

**Files:** `.env.example`, `README.md`.

- [ ] `.env.example`: remove `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; add `CLERK_SECRET_KEY=`, `CLERK_PUBLISHABLE_KEY=` (server) and `VITE_CLERK_PUBLISHABLE_KEY=` (client), each with a short comment and a pointer to the Clerk dashboard (https://dashboard.clerk.com → API keys).
- [ ] `README.md`: update the auth section — Clerk instead of Better Auth/email-password; list the three Clerk env vars; note that sign-in/up is handled by Clerk's hosted components and no local user table exists. Update prerequisites to include "a Clerk application (free)".
- [ ] Full check from `D:\Chatbot`: `npm test` (both suites green), `cd server && npx tsc --noEmit`, `cd client && npx tsc -b --noEmit`, `npm run build -w client`.
- [ ] Boot smoke test (no Clerk keys needed for this part): start the server, `GET /api/health` → `{ ok: true }`, and confirm `GET /api/chats` without a token → 401 (this exercises the real Clerk guard path; with no `CLERK_SECRET_KEY`, `clerkMiddleware` yields no `userId`, so the guard 401s — acceptable and expected).
- [ ] Commit: `docs: Clerk setup (env, README)`.

---

## Self-Review Notes
- **Spec coverage:** 1A drop-tables + userId String (Task 1b); injectable Clerk guard + `req.userId` (1c/1d); prebuilt components + routing/gating (2c); `<UserButton/>` (2d); bearer-token api/useApi/streamChat (2b/2d); test strategy header-guard + Clerk mocks (1e/2e); env+docs (Task 3). All mapped.
- **Type consistency:** guard sets `req.userId` (string) — augmentation in `requireAuth.ts`, read as `req.userId!` in all routes; api helpers all take `token: string | null` first; `useApi` returns the same helper names the components call; `streamChat(chatId, content, token, handlers)` used consistently in `Chat.tsx` and the test.
- **Green-between-tasks:** Task 1 is one cohesive backend swap; Task 2 one cohesive frontend swap — each leaves its suite green (interdependence makes smaller splits non-compiling).
