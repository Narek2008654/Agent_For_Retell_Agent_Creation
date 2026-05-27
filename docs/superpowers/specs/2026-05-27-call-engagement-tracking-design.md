# Call Engagement Tracking — Design

Date: 2026-05-27
Status: Approved (pending spec review)

## Goal

Log every outbound call, and let the operator browse them in a new **Calls**
section. Identify the person called by **email**, accumulate an evolving
"engagement summary" per person, and — when the operator opens a call — show
that person's whole history (summary + a timeline of all their calls).

## Identity

- A person is identified by **email** (normalized: trimmed + lowercased), scoped
  to the operator's Clerk `userId`.
- The chatbot **asks the operator for the callee's email before dialing** (not
  the voice agent mid-call — email-from-speech is unreliable). The email is
  passed when placing the call and stored on the call's `metadata`.

## Data model (2 new tables)

Both scoped by `userId` (Clerk).

**Person**
- `id` (cuid), `userId`, `email`, `summary` (rolling engagement summary, default ""),
  `createdAt`, `updatedAt`.
- Unique `(userId, email)`. One person has many calls.

**Call**
- `id` = Retell `call_id` (primary key → idempotent on webhook retries).
- `userId`, `personId?` (FK Person, null if no email captured), `chatId?`.
- `fromNumber?`, `toNumber?`, `agentId?`, `status?`, `disconnectionReason?`.
- `durationSec` (Int, default 0), `transcript` (full log, default ""),
  `summary` (per-call, default ""), `personEmail?`, `createdAt`.

**Migration:** hand-authored SQL + `prisma migrate deploy` (the project's existing
pattern), so Prisma does not try to drop the `Memory.embedding` pgvector column.

## Capture flow

1. **Placing a call.** `place_phone_call` gains an optional `person_email`
   parameter. The system prompt instructs the bot: before dialing, ask the
   operator for the callee's email. `createPhoneCall` puts `{ chatId, email }`
   in the Retell call `metadata`.

2. **On `call_ended` (webhook, extends the existing handler).**
   - Resolve `chatId` from `metadata`; load the chat to get `userId`. If the chat
     is gone, skip (can't attribute).
   - **Idempotency:** if a `Call` with this `call_id` already exists, ack and stop
     (so retries don't double-update the rolling summary).
   - Build the `Call` from the payload: numbers, agent, status,
     `disconnectionReason`, `durationSec` (from start/end timestamps), `transcript`.
   - Generate the **per-call summary** via OpenAI (`ai.complete`) from the
     transcript; empty transcript → "no conversation / didn't connect".
   - `personEmail` = normalized `metadata.email` (if present).
   - If `personEmail`: upsert `Person (userId, email)`. New person → `summary` =
     this call's summary. Existing → `summary` = `OpenAI(old summary + this call's
     summary)`. Link `Call.personId`.
   - Persist the `Call`.
   - Keep the existing behavior: post the short summary as an assistant message
     in the originating chat.

## API (owner-scoped via the Clerk guard)

- `GET /api/calls` — list the user's calls, newest first:
  `{ id, personEmail, toNumber, status, durationSec, summary, createdAt }`.
- `GET /api/calls/:id` — detail for the engagement view:
  - `call`: full record incl. `transcript`.
  - `person`: `{ email, summary }` or `null`.
  - `history`: all calls for that person (newest first), each
    `{ id, durationSec, status, disconnectionReason, summary, createdAt }`.
    If the call has no person, `history` is just `[this call]`.

## UI — new "Calls" page

- Route `/calls` (list) and `/calls/:id` (detail). Header nav link "Calls" next
  to "Memory". Modeled on the existing Memory page + `useApi`.
- **List:** all calls, newest first — email, duration, date/time, status.
- **Detail (engagement view), matching the reference screenshot:**
  - **Engagement Summary** — the person's rolling `summary`.
  - **Engagement History** — a timeline of all that person's calls; each entry
    shows "Phone call • Duration • timestamp" and expands to that call's full log
    (transcript) + summary.

## Non-goals (v1)

- No SMS / channels other than phone calls (the screenshot shows SMS; we only
  have calls — same layout).
- No real-time push: a new call's summary appears when the Calls page / chat is
  next loaded (no SSE/WebSocket).
- No fuzzy identity matching — exact normalized email only.
- No editing/deleting summaries from the UI.

## Testing

- **Server:** webhook persists a `Call` and upserts/updates the `Person` rolling
  summary (and is idempotent on a repeated `call_id`); `GET /api/calls` and
  `GET /api/calls/:id` (with history) are owner-scoped. Use the fake AI + fake
  auth, as existing route tests do.
- **Client:** a Calls page test in the style of `Memory.test.tsx` (list renders;
  detail shows summary + history).
