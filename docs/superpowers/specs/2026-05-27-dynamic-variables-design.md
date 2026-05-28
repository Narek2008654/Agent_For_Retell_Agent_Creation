It wa in the job description TELUS Digital

The call to Armen at +37496200819 has been initiated successfully. If you need any further assistance, feel free to let me know!

Your call has ended. • Duration: 23s • How it ended: agent_hangup • Summary: During the call, the agent offered to discuss the Robotics AI Specialist role at TELUS Digital. However, the user was unable to communicate clearly, leading the agent to suggest it might not be the best time for the conversation. The agent concluded the call, inviting the user to reach out later if interested.

Call again

It seems that the agent Sofi is currently unavailable for calls. Would you like me to use a different agent, such as Emma or Razmik?# Dynamic Variables + Reusable Agents — Design

Date: 2026-05-27
Status: Approved

## Goal

Make created agents reusable across positions and people via Retell dynamic
variables, and have the agent walk into each call already knowing who it's
calling. Adapt the agent-creation flow to author long, variable-rich prompts.

## Mechanism

Retell `create-phone-call` accepts `retell_llm_dynamic_variables` (string→string)
that fill `{{placeholder}}` tokens in the agent's prompt at call time. Standard
variables: `{{caller_name}}`, `{{caller_context}}`, `{{position}}`,
`{{position_details}}`.

## Data

`Person` gains `name String?` and `background String @default("")` (operator's
"what we know" seed). It keeps the rolling `summary`. Still keyed by email.
Hand-authored migration (pgvector-safe).

## Tools

- **`lookup_person(email)`** — returns the stored `{ name, background, summary }`
  or "first interaction." Lets the model decide whether to ask the operator.
- **`place_phone_call`** gains `position`, `position_details`, `caller_name`,
  `caller_background`, `caller_context`. It sends `caller_name`/`caller_context`/
  `position`/`position_details` as `retell_llm_dynamic_variables`, and carries
  `email`/`name`/`background` in `metadata` so the webhook persists them.

## Place-a-call flow (prompt)

1. Get destination number (E.164) and the callee's email.
2. `lookup_person(email)`: first interaction → ask the operator for the person's
   name + what we know (background); returning → reuse stored name/background +
   rolling summary.
3. Pick the agent via `list_agents`; for interviews ask the **position + job
   details**.
4. Compose `caller_context` (background + summary) and call `place_phone_call`.

## Agent-creation flow (prompt, adapted)

Interview the operator about: interaction type (interview / screening / survey /
sales / support / other), main goal, question style (general vs specific) and the
actual questions/topics, persona/tone, voice, name, greeting. Then author a long,
complete prompt that **bakes in the placeholders** above with **fallback wording**
when a variable is empty. Review-before-create stays.

## Plumbing

Tool dependencies bundle into `ToolDeps { retell, chatId?, lookupPerson? }` passed
to `chat` → `runToolCall`. The stream route supplies `chatId` + a DB-backed
`lookupPerson` (scoped to the Clerk user); the AI client supplies `retell`. Keeps
the AI client free of DB access. The `call_ended` webhook persists `name`/
`background` from metadata onto the `Person` (filling only when empty).

## UI

`GET /api/calls/:id` includes the person's `name`; the engagement view shows it.

## Non-goals

No arbitrary user-defined variable names (fixed standard set); no per-agent
variable introspection; exact-email identity unchanged.
