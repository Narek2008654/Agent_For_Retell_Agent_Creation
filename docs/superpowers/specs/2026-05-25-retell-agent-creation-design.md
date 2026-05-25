# Create RetellAI Voice Agent (Tool Calling) — Design Spec

**Date:** 2026-05-25
**Status:** Approved

## Summary

Give the chatbot a function-calling capability: the user asks it to create a voice agent on
RetellAI; the bot **interviews** them (one question at a time) until it has the agent's name,
purpose, behavior, greeting, end-of-call condition, and voice; then it calls a
`create_retell_voice_agent` tool that creates the agent via RetellAI's API and reports the result.

Decisions (approved): user supplies the Retell API key; collect 5 core fields + voice (kept
minimal/expandable); the bot **always asks** which voice (offers a short curated list); the tool
result is relayed as normal streamed chat text, so **no frontend change** is required.

## Capability & interview

- A single OpenAI tool, `create_retell_voice_agent`, is always available to the chat.
- The base system prompt instructs: when the user wants to create a Retell agent, interview them
  one field at a time until all required tool params are known, then call the tool; confirm the
  outcome afterward.
- Tool params (JSON schema, all required): `name`, `purpose`, `instructions` (behavior),
  `greeting` (first thing the agent says), `end_condition` (when to end the call), `voice_id`.
  The prompt has the bot offer a short list of valid Retell voice IDs (e.g. `retell-Cimo`).

## Tool calling in the streaming chat (core change)

`AiClient.streamChat` gains an optional `tools` parameter:
```ts
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the args
  run: (args: Record<string, unknown>) => Promise<string>; // executes; returns a result string
}
streamChat(input: { system: string; messages: ChatMessage[]; tools?: ToolDefinition[] }): AsyncIterable<string>;
```
Real OpenAI implementation runs a loop:
1. Create a streaming completion with `messages` + `tools` (mapped to OpenAI's `tools` format).
2. Forward text deltas to the caller (yield) **and** accumulate any `tool_calls` deltas
   (id, name, arguments JSON).
3. If tool calls were produced: append the assistant tool-call message, run each tool via its
   `run(args)`, append a `tool` result message per call, then loop to step 1 (the follow-up
   completion streams the user-facing confirmation). If no tool calls: done.

Turns with no tool call stream exactly as today (no UX regression). A safety cap (e.g. max 3 tool
iterations) prevents loops.

The **fake AI** is extended so tests can simulate a tool call: when `tools` are present and the
fake is configured to, it invokes `tools[0].run(args)` and then yields a confirmation string.

## Retell integration

`server/src/retell/client.ts` — a `RetellClient` interface, a real impl (`createRetellClient(apiKey)`),
and a `createFakeRetellClient()` for tests.
```ts
interface RetellClient {
  createVoiceAgent(input: {
    name: string; purpose: string; instructions: string;
    greeting: string; endCondition: string; voiceId: string;
  }): Promise<{ agentId: string; llmId: string }>;
}
```
Real impl, against `https://api.retellai.com` with header `Authorization: Bearer <RETELL_API_KEY>`:
1. `POST /create-retell-llm` body `{ model: "gpt-4.1", general_prompt: <composed from purpose +
   instructions + "End the call when: <endCondition>">, begin_message: greeting,
   general_tools: [{ type: "end_call", name: "end_call", description: <endCondition> }] }`
   → read `llm_id`.
2. `POST /create-agent` body `{ response_engine: { type: "retell-llm", llm_id }, voice_id,
   agent_name: name, language: "en-US" }` → read `agent_id`.
3. Return `{ agentId, llmId }`. Throw on non-2xx with the response body in the message.

## Wiring

- `createApp` resolves a `RetellClient` lazily (like the AI client): `opts.retell ?? createRetellClient(env.RETELL_API_KEY ?? "")`. Tests inject the fake.
- The stream route builds the `create_retell_voice_agent` ToolDefinition whose `run(args)` calls
  `retell.createVoiceAgent(mapped args)` and returns a short success string (with `agentId`) or a
  thrown-error message; passes `tools: [tool]` to `ai.streamChat`. The base system prompt gains the
  interview instructions.

## Error handling

- Retell non-2xx → the tool's `run` throws; the loop catches per-tool and feeds an error string
  back to the model, which tells the user it failed and why (e.g. invalid `voice_id`).
- Missing `RETELL_API_KEY` → the real client throws a clear "Retell API key not configured"
  before calling out; surfaced to the user as a chat message.

## Frontend

None. Tool execution is summarized by the model into normal streamed assistant text
(e.g. "✅ Created your Retell agent 'Support Bot' — agent_id `agent_abc`"). This deliberately
avoids touching the chat UI files currently being restyled by other work.

## Config

- `server/.env`: add `RETELL_API_KEY` (optional in the zod schema; the real client errors at call
  time if missing). Update `.env.example` + README.

## Testing

- **Retell client:** `createVoiceAgent` makes the two POSTs with the right paths, bearer header,
  and composed `general_prompt`/`begin_message`/`voice_id` (mock `fetch`); returns `{agentId, llmId}`;
  throws on non-2xx.
- **Tool:** the `create_retell_voice_agent` ToolDefinition's `run` maps args →
  `RetellClient.createVoiceAgent` and returns a string containing the agentId.
- **Stream-with-tools:** inject a fake AI configured to call the tool and a fake Retell client;
  assert the Retell fake received the mapped params and a confirmation was streamed; the user +
  assistant messages are saved.
- Existing tests stay green (no-tool turns unchanged).

## Out of scope (v1, expandable later)

- Full Retell option surface (states, interruption sensitivity, webhooks, post-call analysis,
  knowledge bases), live voice listing, editing/deleting agents, listing created agents in the UI.
