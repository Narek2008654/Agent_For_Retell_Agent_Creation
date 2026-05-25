# RetellAI Agent Creation (Tool Calling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenAI tool, `create_retell_voice_agent`, that the chatbot calls after interviewing the user, creating a voice agent on RetellAI via its API.

**Architecture:** `AiClient.streamChat` gains optional `tools` + a streaming tool-call loop. The stream route supplies a `create_retell_voice_agent` tool whose `run` calls an injectable `RetellClient` (two REST calls: create-retell-llm, then create-agent). Tool results are streamed back as normal assistant text — no frontend change.

**Tech Stack:** Express, OpenAI tool calling, RetellAI REST API, Vitest.

---

## Conventions
- Backend-only. Server tests: `npm test -w server` (Docker Postgres up; auth via injected `fakeAuth`).
- Tests never call OpenAI or Retell (inject `createFakeAi` + a fake Retell client).
- Stage ONLY server/ + docs/ files when committing (frontend has concurrent WIP from other work).
- Each task ends green (server tests + `tsc --noEmit`).

## File map
- **New:** `server/src/retell/client.ts` (+ `server/src/retell/__tests__/client.test.ts`).
- **Modified:** `server/src/ai/client.ts` (ToolDefinition + tools in streamChat), `server/src/ai/fakeAi.ts` (no change required — tests override `streamChat`), `server/src/env.ts` (RETELL_API_KEY), `server/src/app.ts` (inject Retell), `server/src/routes/chats.ts` + `server/src/routes/stream.ts` (thread Retell + tool), `server/src/chat/prompt.ts` (interview instructions), tests under `server/src/__tests__/`, `.env.example`, `README.md`.

---

## Task 1: Retell client (interface + real + fake)

**Files:** Create `server/src/retell/client.ts`, `server/src/retell/__tests__/client.test.ts`; modify `server/src/env.ts`.

- [ ] **Step 1:** `env.ts` — add `RETELL_API_KEY: z.string().optional()`.
- [ ] **Step 2: Write the test** `client.test.ts` (mock global `fetch`):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRetellClient } from "../client.js";

beforeEach(() => vi.restoreAllMocks());

it("creates an LLM then an agent and returns ids", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ llm_id: "llm_1" }) } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ agent_id: "agent_1" }) } as Response);
  vi.stubGlobal("fetch", fetchMock);

  const client = createRetellClient("sk_test");
  const out = await client.createVoiceAgent({
    name: "Support", purpose: "help customers", instructions: "be kind",
    greeting: "Hi!", endCondition: "user says bye", voiceId: "retell-Cimo",
  });

  expect(out).toEqual({ agentId: "agent_1", llmId: "llm_1" });

  // First call: create-retell-llm with bearer auth + composed prompt
  const [llmUrl, llmInit] = fetchMock.mock.calls[0];
  expect(String(llmUrl)).toContain("/create-retell-llm");
  expect((llmInit.headers as Record<string,string>).Authorization).toBe("Bearer sk_test");
  const llmBody = JSON.parse(llmInit.body as string);
  expect(llmBody.begin_message).toBe("Hi!");
  expect(llmBody.general_prompt).toContain("be kind");
  expect(llmBody.general_prompt).toContain("user says bye");

  // Second call: create-agent referencing the llm + voice
  const [agentUrl, agentInit] = fetchMock.mock.calls[1];
  expect(String(agentUrl)).toContain("/create-agent");
  const agentBody = JSON.parse(agentInit.body as string);
  expect(agentBody.response_engine).toEqual({ type: "retell-llm", llm_id: "llm_1" });
  expect(agentBody.voice_id).toBe("retell-Cimo");
  expect(agentBody.agent_name).toBe("Support");
});

it("throws on a non-2xx response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad voice" } as Response));
  await expect(createRetellClient("sk").createVoiceAgent({
    name: "x", purpose: "x", instructions: "x", greeting: "x", endCondition: "x", voiceId: "nope",
  })).rejects.toThrow(/422/);
});

it("throws a clear error when no api key is configured", async () => {
  await expect(createRetellClient("").createVoiceAgent({
    name: "x", purpose: "x", instructions: "x", greeting: "x", endCondition: "x", voiceId: "v",
  })).rejects.toThrow(/api key/i);
});
```
- [ ] **Step 3: Run** → FAIL (no module).
- [ ] **Step 4: Implement** `client.ts`:
```ts
const RETELL_BASE = "https://api.retellai.com";

export interface CreateVoiceAgentInput {
  name: string; purpose: string; instructions: string;
  greeting: string; endCondition: string; voiceId: string;
}

export interface RetellClient {
  createVoiceAgent(input: CreateVoiceAgentInput): Promise<{ agentId: string; llmId: string }>;
}

export function createRetellClient(apiKey: string): RetellClient {
  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    if (!apiKey) throw new Error("Retell API key not configured");
    const res = await fetch(`${RETELL_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Retell ${path} failed: ${res.status}${text ? ` ${text}` : ""}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  return {
    async createVoiceAgent(input) {
      const generalPrompt =
        `${input.purpose}\n\n${input.instructions}\n\nEnd the call when: ${input.endCondition}`;
      const llm = await post("/create-retell-llm", {
        model: "gpt-4.1",
        general_prompt: generalPrompt,
        begin_message: input.greeting,
        general_tools: [{ type: "end_call", name: "end_call", description: input.endCondition }],
      });
      const llmId = String(llm["llm_id"]);
      const agent = await post("/create-agent", {
        response_engine: { type: "retell-llm", llm_id: llmId },
        voice_id: input.voiceId,
        agent_name: input.name,
        language: "en-US",
      });
      return { agentId: String(agent["agent_id"]), llmId };
    },
  };
}

/** Deterministic fake for tests. */
export function createFakeRetellClient(
  overrides?: Partial<RetellClient> & { calls?: CreateVoiceAgentInput[] },
): RetellClient {
  return {
    createVoiceAgent: overrides?.createVoiceAgent
      ?? (async (input) => {
        overrides?.calls?.push(input);
        return { agentId: "agent_fake", llmId: "llm_fake" };
      }),
  };
}
```
- [ ] **Step 5: Run** → PASS. `npx tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `feat(server): RetellAI client (create-retell-llm + create-agent)`.

## Task 2: Tool calling in the AI client

**Files:** Modify `server/src/ai/client.ts`; Test `server/src/ai/__tests__/toolCalling.test.ts`.

- [ ] **Step 1: Add the ToolDefinition type + tools param** in `client.ts`:
```ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for arguments
  run: (args: Record<string, unknown>) => Promise<string>;
}
```
Change `AiClient.streamChat` signature to accept optional `tools`:
```ts
streamChat(input: { system: string; messages: ChatMessage[]; tools?: ToolDefinition[] }): AsyncIterable<string>;
```
- [ ] **Step 2: Implement the loop** in `createOpenAiClient.streamChat` (replace the current single streaming call):
```ts
async *streamChat({ system, messages, tools }): AsyncGenerator<string> {
  const oaTools = tools?.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const convo = toOpenAiMessages(system, messages) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

  for (let iteration = 0; iteration < 3; iteration++) {
    const stream = await openai.chat.completions.create({
      model: env.CHAT_MODEL,
      messages: convo,
      tools: oaTools,
      stream: true,
    });

    const calls: Record<number, { id: string; name: string; args: string }> = {};
    let assistantText = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) { assistantText += delta.content; yield delta.content; }
      for (const tc of delta?.tool_calls ?? []) {
        const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
    }

    const toolCalls = Object.values(calls);
    if (toolCalls.length === 0) return; // plain answer; already streamed

    convo.push({
      role: "assistant",
      content: assistantText || null,
      tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
    });
    for (const c of toolCalls) {
      const tool = tools?.find((t) => t.name === c.name);
      let result: string;
      try {
        result = tool ? await tool.run(JSON.parse(c.args || "{}")) : `Unknown tool: ${c.name}`;
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      convo.push({ role: "tool", tool_call_id: c.id, content: result });
    }
    // loop continues: follow-up completion streams the user-facing reply
  }
}
```
- [ ] **Step 3: Test** `toolCalling.test.ts` — verify the *fake* path works for the stream route by overriding `streamChat` is the route's concern; here, unit-test that a `ToolDefinition.run` is wired correctly by constructing a tool and calling it directly (the OpenAI loop itself isn't unit-tested against the real SDK):
```ts
import { describe, it, expect, vi } from "vitest";
import type { ToolDefinition } from "../client.js";

it("a ToolDefinition.run executes and returns a string", async () => {
  const run = vi.fn(async (args: Record<string, unknown>) => `ran with ${args.x}`);
  const tool: ToolDefinition = { name: "t", description: "d", parameters: { type: "object" }, run };
  expect(await tool.run({ x: 1 })).toBe("ran with 1");
});
```
(The end-to-end tool-call behavior is covered in Task 3 via the fake AI.)
- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` clean (the OpenAI message/tool types line up; cast as shown).
- [ ] **Step 5: Commit** — `feat(server): tool-calling support in the AI client streamChat`.

## Task 3: Wire the create_retell_voice_agent tool into the chat

**Files:** Modify `server/src/app.ts`, `server/src/routes/chats.ts`, `server/src/routes/stream.ts`, `server/src/chat/prompt.ts`; Test in `server/src/__tests__/stream.test.ts`.

- [ ] **Step 1: System prompt** — in `prompt.ts`, append to `BASE_SYSTEM`:
```
\n\nYou can create voice agents on RetellAI. When the user asks you to create one, interview them ONE question at a time until you know: a name, its purpose, how it should behave, the greeting it speaks first, when it should end the call, and which voice (offer: retell-Cimo, retell-Adrian). Only then call the create_retell_voice_agent tool. After it runs, tell the user the result.
```
- [ ] **Step 2: Inject Retell into createApp** (`app.ts`): add `retell?: RetellClient` to `opts`; lazily build the real one:
```ts
let cachedRetell: RetellClient | undefined;
const getRetell = (): RetellClient => opts.retell ?? (cachedRetell ??= createRetellClient(env.RETELL_API_KEY ?? ""));
```
Pass it down: `createChatsRouter(getAi, getRetell)`.
- [ ] **Step 3: Thread through chats → stream** — `createChatsRouter(getAi, getRetell)` forwards to `createStreamRouter(getAi, getRetell)`.
- [ ] **Step 4: Build the tool + pass to streamChat** (`stream.ts`): `createStreamRouter(getAi, getRetell)`; inside the handler, after `const ai = getAi();`:
```ts
const retell = getRetell();
const createAgentTool: ToolDefinition = {
  name: "create_retell_voice_agent",
  description: "Create a voice agent on RetellAI. Only call once all details are gathered.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" }, purpose: { type: "string" }, instructions: { type: "string" },
      greeting: { type: "string" }, end_condition: { type: "string" }, voice_id: { type: "string" },
    },
    required: ["name", "purpose", "instructions", "greeting", "end_condition", "voice_id"],
  },
  run: async (args) => {
    const { agentId } = await retell.createVoiceAgent({
      name: String(args.name), purpose: String(args.purpose), instructions: String(args.instructions),
      greeting: String(args.greeting), endCondition: String(args.end_condition), voiceId: String(args.voice_id),
    });
    return `Created Retell agent "${String(args.name)}" — agent_id ${agentId}.`;
  },
};
```
Change the stream call to `ai.streamChat({ system, messages, tools: [createAgentTool] })`. (Title + memory steps unchanged.)
- [ ] **Step 5: Test** in `stream.test.ts` — a fake AI that drives the tool, plus a fake Retell client:
```ts
test("the create_retell_voice_agent tool runs and streams a confirmation", async () => {
  const calls: any[] = [];
  const fakeRetell = createFakeRetellClient({ calls });
  const toolApp = createApp({
    requireAuth: fakeAuth,
    retell: fakeRetell,
    ai: createFakeAi({
      // eslint-disable-next-line require-yield
      streamChat: async function* (input) {
        if (input.tools && input.tools.length > 0) {
          const out = await input.tools[0].run({
            name: "Support", purpose: "help", instructions: "be kind",
            greeting: "Hi", end_condition: "bye", voice_id: "retell-Cimo",
          });
          yield out;
        } else {
          yield "Hello from the fake AI.";
        }
      },
    }),
  });

  const chatRes = await request(toolApp).post("/api/chats").set("x-test-user-id", USER1).send({ title: "Agent" });
  const res = await request(toolApp)
    .post(`/api/chats/${chatRes.body.id}/stream`)
    .set("x-test-user-id", USER1)
    .send({ content: "create an agent" });

  expect(res.text).toContain("Created Retell agent");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ name: "Support", voiceId: "retell-Cimo", endCondition: "bye" });
});
```
(Import `createFakeRetellClient` from `../retell/client.js`.)
- [ ] **Step 6: Run** `npm test -w server` → all pass. `npx tsc --noEmit` clean.
- [ ] **Step 7: Commit** — `feat(server): create_retell_voice_agent tool wired into the chat`.

## Task 4: Docs + env

**Files:** `.env.example`, `README.md`.

- [ ] **Step 1:** `.env.example` — add under the server section: `# RetellAI API key (https://dashboard.retellai.com) — for creating voice agents` + `RETELL_API_KEY=`.
- [ ] **Step 2:** `README.md` — add `RETELL_API_KEY` to the env table and a short "Voice agents" note: ask the chatbot to create a Retell agent; it interviews you and creates it. (Stage only README + .env.example.)
- [ ] **Step 3: Commit** — `docs: RetellAI env + usage note`.

---

## Self-Review Notes
- **Spec coverage:** Retell client two-call flow + auth + errors (T1); tool-calling streaming loop + ToolDefinition (T2); tool wiring + interview system prompt + injected Retell + getMessages/title/memory untouched (T3); env + docs (T4). All mapped.
- **Type consistency:** `RetellClient.createVoiceAgent({name,purpose,instructions,greeting,endCondition,voiceId})` identical in T1 impl, T3 tool `run`, and the T3 test; `ToolDefinition {name,description,parameters,run}` identical in T2 and T3; `streamChat({system,messages,tools?})` consistent in T2 impl and T3 call/test; `createFakeRetellClient({calls})` used in T3 test matches T1.
- **No frontend:** confirmed — tool result is streamed text; no client files touched (avoids the concurrent design WIP).
- **Greenness:** T1 isolated module; T2 adds an optional param (existing `streamChat({system,messages})` calls still valid); T3 wires it; each ends green.
