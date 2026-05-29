# Brevo Job-Details Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat assistant a `send_email` tool that emails a contact the details of a role (via Brevo) when, reading a call's outcome, it judges them interested and a good fit.

**Architecture:** A new Brevo client (`server/src/brevo/`) mirroring the existing Twilio client (interface + real + fake), a branded HTML email template, a `send_email` OpenAI tool wired through the same DI/`ToolDeps` path as `place_phone_call`, and a Prisma `Email` model persisted via a `saveEmail` callback supplied by `StreamController`.

**Tech Stack:** Node/Express 5 + NestJS DI, TypeScript (ESM, `.js` import specifiers), Prisma 6 + Postgres, OpenAI tool-calling, Vitest. Spec: `docs/superpowers/specs/2026-05-29-brevo-email-design.md`.

---

## File Structure

**Create:**
- `server/src/brevo/client.ts` — Brevo transactional-email client (interface, `createBrevoClient`, `createFakeBrevoClient`).
- `server/src/brevo/template.ts` — `renderJobEmail()` → `{ subject, html, text }`.
- `server/src/brevo/__tests__/client.test.ts` — real client tests against a stubbed `fetch`.
- `server/src/brevo/__tests__/template.test.ts` — template rendering tests.

**Modify:**
- `server/prisma/schema.prisma` — add `Email` model; add `emails Email[]` to `Person`.
- `server/src/env.ts` — add `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME`.
- `server/src/ai/client.ts` — `SEND_EMAIL_TOOL`, `send_email` dispatch case, `ToolDeps.brevo`/`saveEmail`, `SavedEmail` type, `createOpenAiClient` 3rd param, `chat()` input `saveEmail`.
- `server/src/ai/__tests__/toolCalling.test.ts` — `send_email` dispatch tests.
- `server/src/nest/tokens.ts` — `BREVO_CLIENT` token.
- `server/src/nest/app.module.ts` — `BREVO_CLIENT` provider + inject into `AI_CLIENT`.
- `server/src/nest/bootstrap.ts` — `BootstrapOptions.brevo`.
- `server/src/index.ts` — build live Brevo client, pass through.
- `server/src/nest/stream.controller.ts` — `saveEmail` callback.
- `server/src/chat/prompt.ts` — `send_email` guidance in `BASE_SYSTEM`.
- `README.md` — Brevo env vars + prerequisite.

**Conventions to follow:** ESM imports use `.js` specifiers even for `.ts` files. Tool dispatch never throws — failures become an `"Error: ..."` string the model relays. Fakes live alongside real clients in the same module. Tests stub `fetch` with `vi.stubGlobal`.

---

## Task 1: Brevo client

**Files:**
- Create: `server/src/brevo/client.ts`
- Test: `server/src/brevo/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/brevo/__tests__/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBrevoClient } from "../client.js";

describe("createBrevoClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs /v3/smtp/email with the api-key header and a JSON body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "msg_real" }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const out = await createBrevoClient("key_test").sendEmail({
      from: { email: "jobs@acme.com", name: "Acme Talent" },
      to: { email: "cand@example.com", name: "Cand" },
      subject: "Backend Engineer opportunity at Acme",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(out).toEqual({ messageId: "msg_real" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("key_test");
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ email: "jobs@acme.com", name: "Acme Talent" });
    expect(body.to).toEqual([{ email: "cand@example.com", name: "Cand" }]);
    expect(body.subject).toBe("Backend Engineer opportunity at Acme");
    expect(body.htmlContent).toBe("<p>Hi</p>");
    expect(body.textContent).toBe("Hi");
  });

  it("omits the recipient name when not provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m" }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await createBrevoClient("k").sendEmail({
      from: { email: "a@b.com", name: "A" },
      to: { email: "c@d.com" },
      subject: "s",
      html: "h",
      text: "t",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual([{ email: "c@d.com" }]);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" } as Response),
    );
    await expect(
      createBrevoClient("k").sendEmail({
        from: { email: "a@b.com", name: "A" },
        to: { email: "c@d.com" },
        subject: "s",
        html: "h",
        text: "t",
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws clearly when no API key is configured", async () => {
    await expect(
      createBrevoClient("").sendEmail({
        from: { email: "a@b.com", name: "A" },
        to: { email: "c@d.com" },
        subject: "s",
        html: "h",
        text: "t",
      }),
    ).rejects.toThrow(/api key/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- src/brevo/__tests__/client.test.ts`
Expected: FAIL — `Cannot find module '../client.js'`.

- [ ] **Step 3: Implement the client**

Create `server/src/brevo/client.ts`:

```ts
const BREVO_BASE = "https://api.brevo.com/v3";

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

/** Real Brevo client backed by the v3 transactional email API. */
export function createBrevoClient(apiKey: string): BrevoClient {
  return {
    async sendEmail(input) {
      if (!apiKey) throw new Error("Brevo API key not configured");
      const res = await fetch(`${BREVO_BASE}/smtp/email`, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: input.from.email, name: input.from.name },
          to: [input.to.name ? { email: input.to.email, name: input.to.name } : { email: input.to.email }],
          subject: input.subject,
          htmlContent: input.html,
          textContent: input.text,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Brevo sendEmail failed: ${res.status}${text ? ` ${text}` : ""}`);
      }
      const body = (await res.json()) as Record<string, unknown>;
      return { messageId: String(body["messageId"]) };
    },
  };
}

/** Deterministic fake for tests — records sent emails. */
export function createFakeBrevoClient(overrides?: {
  sendEmail?: BrevoClient["sendEmail"];
  messages?: SendEmailInput[];
}): BrevoClient {
  return {
    sendEmail:
      overrides?.sendEmail ??
      (async (input) => {
        overrides?.messages?.push(input);
        return { messageId: "brevo_fake" };
      }),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- src/brevo/__tests__/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/brevo/client.ts server/src/brevo/__tests__/client.test.ts
git commit -m "feat(brevo): transactional email client (real + fake)"
```

---

## Task 2: Email template

**Files:**
- Create: `server/src/brevo/template.ts`
- Test: `server/src/brevo/__tests__/template.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/brevo/__tests__/template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderJobEmail } from "../template.js";

describe("renderJobEmail", () => {
  const base = {
    recipientName: "Cand",
    position: "Backend Engineer",
    companyName: "Acme",
    keyDetails: "Build APIs.\nNode + Postgres.",
    nextSteps: "Reply to confirm.",
    fromName: "Acme Talent",
  };

  it("derives the subject from position and company", () => {
    expect(renderJobEmail(base).subject).toBe("Backend Engineer opportunity at Acme");
  });

  it("includes the recipient name, details, next steps, and signature in the HTML", () => {
    const { html } = renderJobEmail(base);
    expect(html).toContain("Hi Cand,");
    expect(html).toContain("Backend Engineer");
    expect(html).toContain("Build APIs.");
    expect(html).toContain("Reply to confirm.");
    expect(html).toContain("Acme Talent");
  });

  it("greets generically when no recipient name is given", () => {
    const { html, text } = renderJobEmail({ ...base, recipientName: undefined });
    expect(html).toContain("Hi there,");
    expect(text).toContain("Hi there,");
  });

  it("HTML-escapes interpolated values", () => {
    const { html } = renderJobEmail({ ...base, companyName: "<script>x</script>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("produces a plain-text version with the details", () => {
    const { text } = renderJobEmail(base);
    expect(text).toContain("Build APIs.");
    expect(text).toContain("Reply to confirm.");
    expect(text).toContain("Acme Talent");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- src/brevo/__tests__/template.test.ts`
Expected: FAIL — `Cannot find module '../template.js'`.

- [ ] **Step 3: Implement the template**

Create `server/src/brevo/template.ts`:

```ts
export interface JobEmailInput {
  recipientName?: string;
  position: string;
  companyName: string;
  keyDetails: string; // model-composed
  nextSteps: string; // model-composed
  fromName: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render a free-text block into escaped <p> paragraphs (blank line = new paragraph). */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Render the branded job-details email. Subject is derived; body fields are model-composed. */
export function renderJobEmail(input: JobEmailInput): { subject: string; html: string; text: string } {
  const { recipientName, position, companyName, keyDetails, nextSteps, fromName } = input;
  const greeting = recipientName && recipientName.trim() ? recipientName.trim() : "there";
  const subject = `${position} opportunity at ${companyName}`;

  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5;">
    <div style="max-width: 560px; margin: 0 auto; padding: 24px;">
      <p>Hi ${escapeHtml(greeting)},</p>
      <p>Thanks for speaking with us about the <strong>${escapeHtml(position)}</strong> role at <strong>${escapeHtml(companyName)}</strong>. Here are the details:</p>
      <h3 style="margin-bottom: 4px;">Key details</h3>
      ${paragraphs(keyDetails)}
      <h3 style="margin-bottom: 4px;">Next steps</h3>
      ${paragraphs(nextSteps)}
      <p style="margin-top: 24px;">Best regards,<br>${escapeHtml(fromName)}</p>
    </div>
  </body>
</html>`;

  const text = [
    `Hi ${greeting},`,
    ``,
    `Thanks for speaking with us about the ${position} role at ${companyName}. Here are the details:`,
    ``,
    `KEY DETAILS`,
    keyDetails,
    ``,
    `NEXT STEPS`,
    nextSteps,
    ``,
    `Best regards,`,
    fromName,
  ].join("\n");

  return { subject, html, text };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w server -- src/brevo/__tests__/template.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/brevo/template.ts server/src/brevo/__tests__/template.test.ts
git commit -m "feat(brevo): branded job-details email template"
```

---

## Task 3: Prisma Email model + migration

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: Add the `Email` model and the `Person` back-relation**

In `server/prisma/schema.prisma`, add `emails Email[]` to the `Person` model (next to `calls Call[]`):

```prisma
model Person {
  id         String   @id @default(cuid())
  userId     String
  email      String
  name       String?
  background String   @default("")
  summary    String   @default("")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  calls      Call[]
  emails     Email[]

  @@unique([userId, email])
}
```

Then add a new model at the end of the file:

```prisma
// One outbound email sent through Brevo (job-details email to a contact).
model Email {
  id                String   @id @default(cuid())
  userId            String
  personId          String?
  person            Person?  @relation(fields: [personId], references: [id], onDelete: SetNull)
  toEmail           String
  toName            String?
  subject           String
  body              String   @default("") // rendered HTML actually sent
  status            String   // "sent" | "failed"
  providerMessageId String?
  error             String?
  createdAt         DateTime @default(now())

  @@index([userId, createdAt])
  @@index([personId])
}
```

- [ ] **Step 2: Ensure Postgres is up**

Run: `npm run db:up` (from repo root; no-op if already running)
Expected: the `chatbot` Postgres container is running.

- [ ] **Step 3: Create and apply the migration**

Run: `npm run db:migrate -w server -- --name add_emails`
Expected: a new `prisma/migrations/<timestamp>_add_emails/` folder is created, the migration applies cleanly, and the Prisma client regenerates with an `email` model.

- [ ] **Step 4: Verify the generated client typechecks**

Run: `npm run build -w server`
Expected: `tsc` completes with no errors (confirms `prisma.email` is available on the client).

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(db): Email model for sent job-details emails"
```

---

## Task 4: `send_email` tool dispatch

**Files:**
- Modify: `server/src/ai/client.ts`
- Test: `server/src/ai/__tests__/toolCalling.test.ts`

- [ ] **Step 1: Write the failing tests**

In `server/src/ai/__tests__/toolCalling.test.ts`, add to the imports at the top:

```ts
import { runToolCall, normalizePlaceholders, type SavedEmail } from "../client.js";
import { createFakeBrevoClient, type SendEmailInput } from "../../brevo/client.js";
```

(Replace the existing `import { runToolCall, normalizePlaceholders } from "../client.js";` line with the first line above.)

Then add these tests inside the `describe("runToolCall", ...)` block:

```ts
it("sends a job-details email, lowercases the recipient, and records it", async () => {
  const messages: SendEmailInput[] = [];
  const saved: SavedEmail[] = [];
  const brevo = createFakeBrevoClient({ messages });

  const result = await runToolCall(
    {
      retell: createFakeRetellClient(),
      brevo,
      saveEmail: async (e) => {
        saved.push(e);
      },
    },
    toolCall("send_email", {
      recipient_email: "Cand@Example.com",
      recipient_name: "Cand",
      position: "Backend Engineer",
      company_name: "Acme",
      key_details: "Build APIs.",
      next_steps: "Reply to confirm.",
    }),
  );

  expect(result).toContain("Sent job-details email to cand@example.com");
  expect(messages).toHaveLength(1);
  expect(messages[0].to.email).toBe("cand@example.com");
  expect(messages[0].subject).toBe("Backend Engineer opportunity at Acme");
  expect(saved[0]).toMatchObject({
    toEmail: "cand@example.com",
    status: "sent",
    subject: "Backend Engineer opportunity at Acme",
  });
});

it("returns an error and records a failure when sending fails", async () => {
  const saved: SavedEmail[] = [];
  const brevo = createFakeBrevoClient({
    sendEmail: async () => {
      throw new Error("brevo down");
    },
  });

  const result = await runToolCall(
    {
      retell: createFakeRetellClient(),
      brevo,
      saveEmail: async (e) => {
        saved.push(e);
      },
    },
    toolCall("send_email", { recipient_email: "x@y.com", position: "Dev", company_name: "Co" }),
  );

  expect(result).toMatch(/Error: brevo down/);
  expect(saved[0]).toMatchObject({ status: "failed", error: "brevo down" });
});

it("asks for the email when recipient_email is missing", async () => {
  const result = await runToolCall(
    { retell: createFakeRetellClient(), brevo: createFakeBrevoClient() },
    toolCall("send_email", { position: "Dev", company_name: "Co" }),
  );
  expect(result).toMatch(/no recipient_email/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w server -- src/ai/__tests__/toolCalling.test.ts`
Expected: FAIL — `createFakeBrevoClient`/`SavedEmail`/`SendEmailInput` not found, and `send_email` returns `"Unknown tool: send_email"`.

- [ ] **Step 3: Add the import, `SavedEmail` type, tool, and `ToolDeps` fields**

In `server/src/ai/client.ts`, add the Brevo imports near the top (after the existing imports):

```ts
import type { BrevoClient } from "../brevo/client.js";
import { renderJobEmail } from "../brevo/template.js";
```

Add the `SavedEmail` type (place it near `CallerInfo`, around line 46):

```ts
/** A sent (or failed) email to persist. */
export interface SavedEmail {
  toEmail: string;
  toName?: string;
  subject: string;
  body: string; // rendered HTML
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
}
```

Add the tool definition after `LOOKUP_PERSON_TOOL` (around line 217):

```ts
/** Tool: email a contact the details of a role after a call. */
const SEND_EMAIL_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "send_email",
    description:
      "Email a contact the details of a role. Only call after a call where the contact expressed interest and is a good fit. You compose key_details and next_steps in full prose; the subject and layout are handled for you.",
    parameters: {
      type: "object",
      properties: {
        recipient_email: { type: "string", description: "The contact's email address." },
        recipient_name: { type: "string", description: "The contact's name, for the greeting." },
        position: { type: "string", description: "The role/position the email is about." },
        company_name: { type: "string", description: "The company the role is at." },
        key_details: {
          type: "string",
          description:
            "The role's key details in full prose — responsibilities, requirements, compensation, and anything relevant from the call.",
        },
        next_steps: {
          type: "string",
          description:
            "What the contact should do next, in full prose (e.g. reply to confirm, book a time, apply).",
        },
      },
      required: ["recipient_email"],
    },
  },
};
```

Add `SEND_EMAIL_TOOL` to the `TOOLS` array:

```ts
const TOOLS = [
  CREATE_AGENT_TOOL,
  PLACE_CALL_TOOL,
  END_CALL_TOOL,
  LIST_AGENTS_TOOL,
  LOOKUP_PERSON_TOOL,
  SEND_EMAIL_TOOL,
];
```

Extend the `ToolDeps` interface (add the two fields):

```ts
export interface ToolDeps {
  retell: RetellClient;
  brevo?: BrevoClient;
  chatId?: string;
  lookupPerson?: (email: string) => Promise<CallerInfo | null>;
  saveAgentSettings?: (
    agentId: string,
    settings: { noPickupSms: string; noPickupSmsFollowup: string },
  ) => Promise<void>;
  /** Persist a sent/failed email (DB-backed, supplied by the route). */
  saveEmail?: (email: SavedEmail) => Promise<void>;
}
```

- [ ] **Step 4: Add the `send_email` dispatch case**

In `runToolCall`'s `switch`, add this case before `default:`:

```ts
case "send_email": {
  const toEmail = String(args.recipient_email ?? "").trim().toLowerCase();
  if (!toEmail) {
    return "Cannot send the email: no recipient_email was provided. Ask the user for the contact's email, then call send_email again.";
  }
  if (!deps.brevo) return "Error: email sending is not configured.";
  const toName = args.recipient_name ? String(args.recipient_name) : undefined;
  const { subject, html, text } = renderJobEmail({
    recipientName: toName,
    position: String(args.position ?? "the role"),
    companyName: String(args.company_name ?? ""),
    keyDetails: String(args.key_details ?? ""),
    nextSteps: String(args.next_steps ?? ""),
    fromName: env.BREVO_FROM_NAME ?? "",
  });
  try {
    const { messageId } = await deps.brevo.sendEmail({
      from: { email: env.BREVO_FROM_EMAIL ?? "", name: env.BREVO_FROM_NAME ?? "" },
      to: { email: toEmail, name: toName },
      subject,
      html,
      text,
    });
    if (deps.saveEmail) {
      await deps
        .saveEmail({ toEmail, toName, subject, body: html, status: "sent", providerMessageId: messageId })
        .catch(() => {});
    }
    return `Sent job-details email to ${toEmail} (message ${messageId}).`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (deps.saveEmail) {
      await deps.saveEmail({ toEmail, toName, subject, body: html, status: "failed", error: message }).catch(() => {});
    }
    return `Error: ${message}`;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w server -- src/ai/__tests__/toolCalling.test.ts`
Expected: PASS — all existing tests plus the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/client.ts server/src/ai/__tests__/toolCalling.test.ts
git commit -m "feat(ai): send_email tool dispatch via Brevo"
```

---

## Task 5: Env vars + DI wiring

**Files:**
- Modify: `server/src/env.ts`, `server/src/ai/client.ts`, `server/src/nest/tokens.ts`, `server/src/nest/app.module.ts`, `server/src/nest/bootstrap.ts`, `server/src/index.ts`

This task changes `createOpenAiClient`'s signature and all its call sites together, so the project keeps compiling. No new tests; correctness is verified by `tsc` (Step 7) and the full suite (Step 8).

- [ ] **Step 1: Add env vars**

In `server/src/env.ts`, add inside the `envSchema` object (after the Twilio vars):

```ts
  // Brevo transactional email (job-details email to interested contacts).
  BREVO_API_KEY: z.string().optional(),
  BREVO_FROM_EMAIL: z.string().optional(),
  BREVO_FROM_NAME: z.string().default("Recruiting"),
```

- [ ] **Step 2: Thread `brevo` + `saveEmail` through `createOpenAiClient` / `chat()`**

In `server/src/ai/client.ts`, add `saveEmail` to the `AiClient.chat` input type:

```ts
  chat(input: {
    system: string;
    messages: ChatMessage[];
    chatId?: string;
    lookupPerson?: (email: string) => Promise<CallerInfo | null>;
    saveAgentSettings?: (
      agentId: string,
      settings: { noPickupSms: string; noPickupSmsFollowup: string },
    ) => Promise<void>;
    saveEmail?: (email: SavedEmail) => Promise<void>;
  }): AsyncIterable<string>;
```

Change the `createOpenAiClient` signature to accept `brevo`:

```ts
export function createOpenAiClient(apiKey: string, retell: RetellClient, brevo: BrevoClient): AiClient {
```

In the `chat` generator, add `saveEmail` to the destructured params and its inline type, and include `brevo`/`saveEmail` in `deps`. The updated header and `deps` line:

```ts
    async *chat({
      system,
      messages,
      chatId,
      lookupPerson,
      saveAgentSettings,
      saveEmail,
    }: {
      system: string;
      messages: ChatMessage[];
      chatId?: string;
      lookupPerson?: (email: string) => Promise<CallerInfo | null>;
      saveAgentSettings?: (
        agentId: string,
        settings: { noPickupSms: string; noPickupSmsFollowup: string },
      ) => Promise<void>;
      saveEmail?: (email: SavedEmail) => Promise<void>;
    }): AsyncGenerator<string> {
      const convo = toOpenAiMessages(system, messages) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      const deps: ToolDeps = { retell, brevo, chatId, lookupPerson, saveAgentSettings, saveEmail };
```

- [ ] **Step 3: Add the `BREVO_CLIENT` token**

In `server/src/nest/tokens.ts`:

```ts
/** Injection tokens for controllers that depend on runtime-built clients. */
export const AI_CLIENT = "AI_CLIENT";
export const RETELL_CLIENT = "RETELL_CLIENT";
export const TWILIO_CLIENT = "TWILIO_CLIENT";
export const BREVO_CLIENT = "BREVO_CLIENT";
```

- [ ] **Step 4: Wire the provider in `app.module.ts`**

In `server/src/nest/app.module.ts`:

Add imports:

```ts
import { createBrevoClient, type BrevoClient } from "../brevo/client.js";
```

and add `BREVO_CLIENT` to the tokens import:

```ts
import { AI_CLIENT, RETELL_CLIENT, TWILIO_CLIENT, BREVO_CLIENT } from "./tokens.js";
```

Extend the `register` options:

```ts
  static register(
    opts: { ai?: AiClient; retell?: RetellClient; twilio?: TwilioClient; brevo?: BrevoClient } = {},
  ): DynamicModule {
```

Add a `BREVO_CLIENT` provider and inject it into the `AI_CLIENT` factory. Replace the existing `AI_CLIENT` provider and add the Brevo provider:

```ts
        {
          provide: BREVO_CLIENT,
          useFactory: (): BrevoClient => opts.brevo ?? createBrevoClient(env.BREVO_API_KEY ?? ""),
        },
        {
          provide: AI_CLIENT,
          inject: [RETELL_CLIENT, BREVO_CLIENT],
          useFactory: (retell: RetellClient, brevo: BrevoClient): AiClient =>
            opts.ai ?? createOpenAiClient(env.OPENAI_API_KEY ?? "", retell, brevo),
        },
```

- [ ] **Step 5: Extend `BootstrapOptions`**

In `server/src/nest/bootstrap.ts`:

Add the import:

```ts
import type { BrevoClient } from "../brevo/client.js";
```

Add to `BootstrapOptions`:

```ts
  brevo?: BrevoClient;
```

Pass it through in the `AppModule.register` call:

```ts
    AppModule.register({ ai: opts.ai, retell: opts.retell, twilio: opts.twilio, brevo: opts.brevo }),
```

- [ ] **Step 6: Build and pass the live client in `index.ts`**

In `server/src/index.ts`:

Add the import:

```ts
import { createBrevoClient } from "./brevo/client.js";
```

Build the client and update the two call sites:

```ts
const retell = createRetellClient(env.RETELL_API_KEY ?? "", { webhookUrl: env.RETELL_WEBHOOK_URL });
const brevo = createBrevoClient(env.BREVO_API_KEY ?? "");
const ai = createOpenAiClient(env.OPENAI_API_KEY ?? "", retell, brevo);
const twilio = createTwilioClient(env.TWILIO_ACCOUNT_SID ?? "", env.TWILIO_AUTH_TOKEN ?? "");

const app = await bootstrap({ ai, retell, twilio, brevo });
```

- [ ] **Step 7: Typecheck the whole server**

Run: `npm run build -w server`
Expected: `tsc` completes with no errors (confirms every `createOpenAiClient` call site now passes `brevo`).

- [ ] **Step 8: Run the full server suite**

Run: `npm test -w server`
Expected: all suites PASS (the `fakeAi` used by integration tests ignores the new `saveEmail` input, so nothing regresses).

- [ ] **Step 9: Commit**

```bash
git add server/src/env.ts server/src/ai/client.ts server/src/nest/tokens.ts server/src/nest/app.module.ts server/src/nest/bootstrap.ts server/src/index.ts
git commit -m "feat(brevo): wire Brevo client through Nest DI + env"
```

---

## Task 6: Persist sent emails from `StreamController`

**Files:**
- Modify: `server/src/nest/stream.controller.ts`

- [ ] **Step 1: Supply the `saveEmail` callback**

In `server/src/nest/stream.controller.ts`, inside the `this.ai.chat({ ... })` call, add a `saveEmail` callback after the existing `saveAgentSettings` callback (before the closing `})`):

```ts
        saveEmail: async (email) => {
          const person = await this.prisma.person.findUnique({
            where: { userId_email: { userId, email: email.toEmail } },
            select: { id: true },
          });
          await this.prisma.email.create({
            data: {
              userId,
              personId: person?.id ?? null,
              toEmail: email.toEmail,
              toName: email.toName ?? null,
              subject: email.subject,
              body: email.body,
              status: email.status,
              providerMessageId: email.providerMessageId ?? null,
              error: email.error ?? null,
            },
          });
        },
```

(The `toEmail` arriving here is already trimmed + lowercased by the `send_email` dispatch, so it matches the `Person.email` storage convention used by `lookupPerson`.)

- [ ] **Step 2: Typecheck**

Run: `npm run build -w server`
Expected: no errors (`prisma.email.create` and the `saveEmail` shape line up with `SavedEmail`).

- [ ] **Step 3: Run the full server suite**

Run: `npm test -w server`
Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/nest/stream.controller.ts
git commit -m "feat(stream): persist sent job-details emails"
```

---

## Task 7: Prompt guidance

**Files:**
- Modify: `server/src/chat/prompt.ts`

- [ ] **Step 1: Append the `send_email` section to `BASE_SYSTEM`**

In `server/src/chat/prompt.ts`, append this paragraph to the end of the `BASE_SYSTEM` template string (just before the closing `` ` ``, after the `end_phone_call` bullet):

```
\n\nYou can also email a contact the details of a role using send_email. After a call, if the contact expressed interest and is a good fit, compose a concise, professional email and call send_email with their email (recipient_email) and name (recipient_name), the role (position), the company (company_name), and two prose fields you write yourself: key_details (the role's responsibilities/requirements, compensation if known, and anything relevant from the call) and next_steps (what they should do next — e.g. reply to confirm, book a time, apply). The subject line and layout are generated for you, so don't include a subject. After sending, tell the operator who you emailed and a one-line summary of what you sent. Never claim an email was sent unless send_email returned a confirmation; if it returns a string starting with "Error:", tell the operator you couldn't send it and why, and do not retry blindly.
```

- [ ] **Step 2: Verify the existing prompt test still passes**

Run: `npm test -w server -- src/chat/__tests__/prompt.test.ts`
Expected: PASS (the prompt test asserts structure/placeholders, not the new paragraph; if it asserts an exact full-string match that now fails, update that expectation to include the new sentence).

- [ ] **Step 3: Commit**

```bash
git add server/src/chat/prompt.ts
git commit -m "feat(prompt): instruct the model on send_email"
```

---

## Task 8: Docs + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the env vars**

In `README.md`, add three rows to the "Environment variables" table (after the `TWILIO_*` rows):

```
| `BREVO_API_KEY` | server | Brevo transactional email API key |
| `BREVO_FROM_EMAIL` | server | Verified sender email (must be a verified sender/domain in Brevo) |
| `BREVO_FROM_NAME` | server | Sender display name (default `Recruiting`) |
```

Add a prerequisite bullet under "Prerequisites":

```
- [Brevo](https://app.brevo.com) account (API key + a verified sender email) — for sending job-details emails
```

In the "What it does" list, add a bullet describing the feature:

```
- **Job-details email** — when a contact expressed interest on a call and looks
  like a good fit, the assistant emails them the role's key details and next
  steps via Brevo (logged as an `Email` record, linked to the `Person`).
```

- [ ] **Step 2: Run the full test suite (server + client)**

Run: `npm test`
Expected: all server and client suites PASS.

- [ ] **Step 3: Final typecheck**

Run: `npm run build -w server`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document Brevo job-details email + env vars"
```

---

## Self-Review notes

- **Spec coverage:** Brevo client (Task 1) ✓; template (Task 2) ✓; Email model + migration (Task 3) ✓; `send_email` tool + error handling + never-throws (Task 4) ✓; env vars + DI wiring + `createOpenAiClient` signature (Task 5) ✓; `saveEmail` persistence + Person linking (Task 6) ✓; prompt guidance (Task 7) ✓; tests + README/env summary (Tasks 1–4, 8) ✓.
- **Type consistency:** `SavedEmail` (defined Task 4) is used identically in `ToolDeps.saveEmail`, the `chat()` input (Task 5), and `StreamController` (Task 6). `BrevoClient`/`SendEmailInput` (Task 1) and `renderJobEmail` (Task 2) signatures match their consumers in Task 4. `BREVO_CLIENT` token name is consistent across Tasks 3–5.
- **Sequencing:** Task 4 is self-contained (unit-tests `runToolCall` directly, no `createOpenAiClient` change). Task 5 changes the `createOpenAiClient` signature and all call sites in one commit so `tsc` stays green. Task 6 depends on the Email model (Task 3) and `SavedEmail` (Task 4).
```
