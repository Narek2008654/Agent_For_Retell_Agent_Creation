# Brevo job-details email — design

**Date:** 2026-05-29
**Status:** Approved, ready for implementation plan

## Goal

When the chat assistant — reading a call's outcome and transcript in the
conversation — judges that a contact expressed interest and is a good fit, it
sends them a **job-details email** explaining the key details and next steps,
delivered through [Brevo](https://www.brevo.com)'s transactional email API.

This mirrors the existing voice/SMS surface: the model already places calls
(`place_phone_call`) and follows up by SMS on no-pickup (Twilio). Email is the
next outbound channel, but driven by the model's judgment rather than a call
lifecycle event.

## Non-goals

- No automatic send from the webhook handler. The "good candidate?" judgment
  lives with the chat model, which sees the post-call summary in the thread.
- No email-composition UI, no "Emails" page. (Persistence is added now so a
  future UI is cheap, but none is built here.)
- No per-email sender selection. A single configured sender is used for all
  emails.
- No threading/replies/inbound handling.

## Approach

A new `send_email` OpenAI tool, structurally identical to the existing tools in
`server/src/ai/client.ts`. The model supplies structured fields; we render a
branded HTML template, send via Brevo, persist an `Email` row, and return a
short success/failure string the model relays to the operator.

Rejected alternatives:
- **Auto-send from the webhook** — the webhook lacks job-details context and the
  candidate-fit judgment.
- **Hybrid (webhook flags interest, model sends)** — extra moving parts the
  chat model's view of the thread already covers. YAGNI.

## Components

### 1. Brevo client — `server/src/brevo/client.ts`

Same shape as `server/src/twilio/client.ts` (interface + real + fake):

```ts
export interface SendEmailInput {
  from: { email: string; name: string };
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

export interface BrevoClient {
  /** Send a transactional email via Brevo. Returns Brevo's messageId. */
  sendEmail(input: SendEmailInput): Promise<{ messageId: string }>;
}

export function createBrevoClient(apiKey: string): BrevoClient;
export function createFakeBrevoClient(overrides?): BrevoClient;
```

- Real client: `POST https://api.brevo.com/v3/smtp/email` with headers
  `api-key: <BREVO_API_KEY>`, `content-type: application/json`,
  `accept: application/json`. Body:
  `{ sender: {name, email}, to: [{email, name?}], subject, htmlContent, textContent }`.
  Throws `Error("Brevo sendEmail failed: <status> <body>")` on non-2xx and
  `Error("Brevo API key not configured")` when `apiKey` is empty — matching the
  Twilio client's error style.
- Returns `{ messageId: String(body.messageId) }`.
- Fake: records sent emails into an optional `messages` array, returns
  `{ messageId: "brevo_fake" }`; `sendEmail` overridable for error-path tests.

### 2. Email template — `server/src/brevo/template.ts`

```ts
renderJobEmail(input: {
  recipientName?: string;
  position: string;
  companyName: string;
  keyDetails: string;   // model-composed
  nextSteps: string;    // model-composed
  fromName: string;
}): { subject: string; html: string; text: string };
```

- **Subject** is template-derived: `"{position} opportunity at {companyName}"`
  (model does not write the subject).
- **HTML**: a simple branded shell — greeting (`Hi {recipientName}` /
  `Hi there` when absent) → "key details" block → "next steps" block →
  signature (`fromName`). All interpolated values HTML-escaped. Free-text
  `keyDetails` / `nextSteps` newlines converted to `<br>` / paragraphs.
- **text**: plain-text equivalent (deliverability fallback). Returned to Brevo
  as `textContent`.

### 3. `send_email` tool — `server/src/ai/client.ts`

Tool definition (added to the `TOOLS` array):

```
name: send_email
description: Email a contact the details of a role after a call, when they
  expressed interest and are a good fit. Only call when those conditions hold.
parameters:
  recipient_email (string, required)
  recipient_name  (string)
  position        (string)  // the role
  company_name    (string)
  key_details     (string)  // model-composed: responsibilities, requirements, comp, etc.
  next_steps      (string)  // model-composed: what the candidate should do next
required: [recipient_email, position, company_name]
```

(`position` and `company_name` are required because the subject line is derived
from them; `recipient_email` is still the primary required field.)

`ToolDeps` gains:
- `brevo: BrevoClient`
- `saveEmail?: (record: SavedEmail) => Promise<void>` (DB-backed, supplied by
  the route, same pattern as `saveAgentSettings`).

`createOpenAiClient(apiKey, retell, brevo)` — `brevo` threaded into the `deps`
built inside `chat()`. The `chat()` input object gains an optional `saveEmail`
callback alongside `lookupPerson` / `saveAgentSettings`.

`runToolCall` `send_email` case:
1. Normalize `recipient_email` (trim + lowercase).
2. `renderJobEmail({...args, fromName: env.BREVO_FROM_NAME})`.
3. `brevo.sendEmail({ from: {email: env.BREVO_FROM_EMAIL, name: env.BREVO_FROM_NAME}, to: {email, name}, subject, html, text })`.
4. On success: `deps.saveEmail?.({status:"sent", providerMessageId, toEmail, toName, subject, body:html})`; return
   `"Sent job-details email to <email> (message <id>)."`. (The `position` /
   `company_name` are captured in the derived `subject`, so they aren't stored
   as separate `Email` columns.)
5. On failure (caught): `deps.saveEmail?.({status:"failed", error, ...})` then
   return `"Error: <message>"`. Like the other tools, **never throws** — the
   error becomes text the model reads and explains.

### 4. Persistence — Prisma `Email` model + migration

```prisma
model Email {
  id                String   @id @default(cuid())
  userId            String
  personId          String?
  person            Person?  @relation(fields: [personId], references: [id], onDelete: SetNull)
  toEmail           String
  toName            String?
  subject           String
  body              String   @default("")  // rendered HTML actually sent
  status            String                 // "sent" | "failed"
  providerMessageId String?
  error             String?
  createdAt         DateTime @default(now())

  @@index([userId, createdAt])
  @@index([personId])
}
```

Add `emails Email[]` to the `Person` model. Migration via
`npm run db:migrate -w server`.

`saveEmail` callback in `StreamController` (mirrors `saveAgentSettings`):
- Look up `Person` by `(userId, email)`; set `personId` if found (else null).
- Create the `Email` row with the supplied fields.

### 5. Wiring

- `server/src/env.ts`: add `BREVO_API_KEY`, `BREVO_FROM_EMAIL`,
  `BREVO_FROM_NAME` (all `z.string().optional()`; `BREVO_FROM_NAME` may default
  to a sensible string).
- `server/src/nest/tokens.ts`: add `BREVO_CLIENT` token.
- `server/src/nest/app.module.ts`: add a `BREVO_CLIENT` provider
  (`opts.brevo ?? createBrevoClient(env.BREVO_API_KEY ?? "")`); the `AI_CLIENT`
  factory now injects `[RETELL_CLIENT, BREVO_CLIENT]` and passes both to
  `createOpenAiClient`. `register(opts)` accepts `brevo?: BrevoClient`.
- `server/src/nest/bootstrap.ts`: `BootstrapOptions.brevo?: BrevoClient`,
  threaded into `AppModule.register`.
- `server/src/index.ts`: build the live `brevo` client and pass it to
  `bootstrap({ ai, retell, twilio, brevo })`; pass `brevo` into
  `createOpenAiClient`.
- `README.md`: document the three env vars (Brevo verified-sender caveat) in the
  Environment variables table and prerequisites.

### 6. Prompt — `server/src/chat/prompt.ts`

Append a short section to `BASE_SYSTEM`:

> You can also email a contact the details of a role using `send_email`. After a
> call, if the contact expressed interest and is a good fit, compose a concise,
> professional email — `key_details` (the role's responsibilities/requirements
> and anything relevant from the call) and `next_steps` (what they should do
> next) — and call `send_email` with their email, name, the position, and the
> company. You write `key_details` and `next_steps` in full prose; the subject
> and layout are handled for you. Tell the operator what you sent. Never claim an
> email was sent unless the tool returned success; if it returns a string
> starting with "Error:", relay that you couldn't send and why.

## Data flow

```
operator chat turn ─▶ StreamController.stream
                        builds ToolDeps{ brevo, saveEmail, ... }
                        ai.chat(...)
model reads call summary/transcript in thread
  └─ decides interested + good fit
       └─ send_email tool call
            ├─ renderJobEmail()  → subject/html/text
            ├─ brevo.sendEmail() → { messageId }   (Brevo v3 /smtp/email)
            ├─ saveEmail()       → Email row (linked to Person by email)
            └─ returns "Sent job-details email to <email>."
model relays confirmation to operator (streamed)
```

## Error handling

- Empty `BREVO_API_KEY` / non-2xx from Brevo → `sendEmail` throws → caught in
  `runToolCall` → persisted as `status:"failed"` with the error → returned as an
  `"Error: ..."` string. The turn never 500s; the model explains the failure.
- Missing `recipient_email` → tool returns a corrective string asking for it
  (no Brevo call).
- `saveEmail` is optional/best-effort; a persistence failure must not mask a
  successful send (log, don't throw past the tool boundary).

## Testing

- `server/src/brevo/__tests__/client.test.ts` — real client with a stubbed
  `fetch`: success returns `messageId`; non-2xx throws with status/body; empty
  key throws.
- `server/src/brevo/__tests__/template.test.ts` — `renderJobEmail` includes the
  fields, derives the subject, HTML-escapes interpolated values, handles a
  missing `recipientName`.
- `server/src/ai/__tests__/toolCalling.test.ts` — add a `send_email` dispatch
  case using `createFakeBrevoClient`: asserts the email is sent with the
  rendered subject/recipient and `saveEmail` is invoked; assert the error path
  returns an `"Error:"` string and records `status:"failed"`.

All real network calls remain faked — no live Brevo calls in tests.

## Config / env summary

| Variable | Where | Purpose |
|---|---|---|
| `BREVO_API_KEY` | server | Brevo transactional email API key |
| `BREVO_FROM_EMAIL` | server | Verified sender email (must be verified in Brevo) |
| `BREVO_FROM_NAME` | server | Sender display name |
