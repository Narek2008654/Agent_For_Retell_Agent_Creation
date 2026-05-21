# Chatbot

An OpenAI-powered chat application with authentication and long-term memory.

The assistant streams replies token-by-token, keeps persistent chat threads, and
remembers durable facts about you (your name, preferences, context) across separate
conversations using semantic search over a vector store.

## Architecture

A npm-workspaces monorepo:

```
chatbot/
├─ client/   React + Vite + TypeScript, Tailwind + shadcn/ui, React Router, TanStack Query
├─ server/   Express + TypeScript, Clerk, Prisma, OpenAI, SSE streaming
└─ docker-compose.yml   Postgres 16 + pgvector
```

- **Auth** — [Clerk](https://clerk.com) (hosted identity). The frontend uses Clerk's prebuilt
  `<SignIn/>`/`<SignUp/>`/`<UserButton/>` components; the API authenticates each request with a
  Clerk bearer token and scopes data by the Clerk user ID. No user records are stored locally.
- **Chat** — each turn is streamed from OpenAI to the browser over Server-Sent Events.
  Threads and messages are persisted in Postgres.
- **Memory** — after each exchange the server asks the model to extract durable user facts,
  embeds them with OpenAI `text-embedding-3-small` (1536-dim), and stores them in a pgvector
  column. On every new message it embeds the message and pulls the most relevant facts
  (cosine similarity) into the system prompt, so the bot recalls them in future chats.

| Layer | Tech |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query |
| Backend | Node/Express, TypeScript, Clerk, Prisma |
| Database | PostgreSQL + pgvector |
| AI | OpenAI (`gpt-4o-mini` chat, `text-embedding-3-small` embeddings) — both configurable |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for Postgres + pgvector)
- [Node.js](https://nodejs.org/) v20+ (developed on v24)
- An [OpenAI API key](https://platform.openai.com/api-keys)
- A free [Clerk](https://dashboard.clerk.com) application (for the publishable + secret keys)

## Getting started

1. **Install dependencies** (installs both workspaces)

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example server/.env
   cp .env.example client/.env
   ```

   In `server/.env` set at minimum:
   - `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` — from the Clerk dashboard (API keys)
   - `OPENAI_API_KEY` — required for chat replies and memory extraction

   In `client/.env` set:
   - `VITE_CLERK_PUBLISHABLE_KEY` — the same Clerk publishable key
   - `VITE_API_URL` — defaults to `http://localhost:3000`

3. **Start the database**

   ```bash
   npm run db:up
   ```

4. **Run database migrations**

   ```bash
   npm run db:migrate -w server
   ```

5. **Start both dev servers**

   ```bash
   npm run dev
   ```

   - API server: <http://localhost:3000>
   - Client: <http://localhost:5173>

   Open the client, sign up via Clerk, and start chatting. Tell the bot something about
   yourself, then start a **new** chat and ask about it — it should recall the fact. Manage
   stored facts on the **Memory** page.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | server | Postgres connection (matches docker-compose defaults) |
| `CLERK_SECRET_KEY` | server | Clerk secret key (verifies session tokens) |
| `CLERK_PUBLISHABLE_KEY` | server | Clerk publishable key |
| `CLIENT_URL` | server | Allowed CORS origin (default `http://localhost:5173`) |
| `OPENAI_API_KEY` | server | OpenAI API key |
| `VITE_CLERK_PUBLISHABLE_KEY` | client | Clerk publishable key (for `<ClerkProvider>`) |
| `CHAT_MODEL` | server | Chat model (default `gpt-4o-mini`) |
| `EMBEDDING_MODEL` | server | Embedding model (default `text-embedding-3-small`, 1536-dim) |
| `VITE_API_URL` | client | Base URL of the API server |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start server + client together |
| `npm run dev:server` / `npm run dev:client` | Start one side only |
| `npm run db:up` / `npm run db:down` | Start / stop the Postgres container |
| `npm run db:migrate -w server` | Apply Prisma migrations |
| `npm test` | Run all test suites (server + client) |
| `npm test -w server` / `npm test -w client` | Run one workspace's tests |

## Testing

- **Server** — Vitest + supertest. Unit tests for the prompt builder, memory store, and
  fact extraction (with a deterministic fake AI client — no real API calls); integration
  tests for the auth guard, chat CRUD/ownership, and the SSE streaming turn run against the
  Docker Postgres. Tests inject a fake header-based auth guard, so no Clerk keys are needed.
  The database must be running (`npm run db:up`) for the integration tests.
- **Client** — Vitest + React Testing Library for the SSE parser, the token-binding `useApi`
  hook, and the memory page (Clerk is mocked in tests).

## Notes

- If the embedding model changes, the `vector(1536)` dimension in
  `server/prisma/migrations/*_memory_vector/migration.sql` must change to match.
- The API authenticates via Clerk bearer tokens and scopes all data by the Clerk user ID
  (`req.userId`); there is no local user table. The auth guard is injectable
  (`server/src/middleware/clerkAuth.ts` in production, a header-based fake in tests).
