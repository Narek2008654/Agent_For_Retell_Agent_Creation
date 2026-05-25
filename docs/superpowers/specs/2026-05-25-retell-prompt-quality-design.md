# Retell Agent Prompt Quality — Design Spec

**Date:** 2026-05-25
**Status:** Approved
**Supersedes:** the prompt-composition part of `2026-05-25-retell-agent-creation-design.md`.

## Problem

The first version composed the Retell `general_prompt` by concatenating short interview answers
(`purpose + instructions + "End the call when: " + endCondition`). That produces a weak,
incomplete agent prompt — no call flow, no handling for silence, sensitive/compensation questions,
objections, voicemail, etc. Real voice agents need a thorough, structured prompt.

## Fix (approved)

The chatbot **authors the full Retell system prompt itself**, then lets the user review/edit it
before creating the agent.

1. **Model writes the prompt.** The `create_retell_voice_agent` tool's thin `purpose` /
   `instructions` / `end_condition` params are replaced by one rich **`agent_prompt`** field (the
   complete system prompt). `name`, `greeting`, `voice_id` remain.
2. **Interview → draft → review → create** (driven by the system prompt, no extra mechanism):
   - Interview the user briefly for the specifics the model can't infer (company/role facts, what
     to pitch, how to schedule the interview, persona/tone).
   - **Draft** a thorough, structured prompt that ALWAYS includes, using professional defaults:
     persona, goal, a step-by-step call flow, and a **guardrails** section covering — no
     response / silence, sensitive or compensation/personal questions (deflect, stay in scope),
     objections / "not interested" (acknowledge, end gracefully), voicemail / wrong person,
     scheduling the interview, and explicit **end-call conditions**.
   - **Show the draft to the user** and incorporate edits; only after the user approves does the
     model call `create_retell_voice_agent` with the final `agent_prompt`.
3. **Retell client passes it through.** `createVoiceAgent` uses `agent_prompt` directly as
   `general_prompt` (no concatenation). The `begin_message` is `greeting`; the `end_call` tool
   stays so the agent can hang up (when conditions described in the prompt are met).

## Changes

- `server/src/retell/client.ts` — `CreateVoiceAgentInput` becomes
  `{ name; systemPrompt; greeting; voiceId }`; `general_prompt = systemPrompt`. (`end_call` tool
  kept with a generic description; end logic lives in `systemPrompt`.)
- `server/src/routes/stream.ts` — tool params: `name`, `agent_prompt`, `greeting`, `voice_id`
  (all required); `run` maps `agent_prompt → systemPrompt`.
- `server/src/chat/prompt.ts` — replace the Retell interview instructions with the
  interview → draft → review → create guidance + the guardrail checklist above.
- Tests updated: Retell client asserts `general_prompt === systemPrompt`; stream tool test uses
  the new param shape and asserts the fake Retell received `{name, systemPrompt, greeting, voiceId}`.

## Out of scope (later)

Native Retell knobs (max-silence timeout, voicemail detection, interruption sensitivity), and
storing/editing created agents. For now those behaviors live in the prompt text.
