import OpenAI from "openai";
import { env } from "../env.js";
import type { RetellClient } from "../retell/client.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Data URLs of images attached to this (user) message, for vision. */
  imageDataUrls?: string[];
}

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string | OpenAiContentPart[];
}

/**
 * Map our messages to OpenAI chat format. A user message carrying images is
 * expanded into multimodal content parts (text + image_url) for vision.
 */
export function toOpenAiMessages(system: string, messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user" && m.imageDataUrls && m.imageDataUrls.length > 0) {
      const parts: OpenAiContentPart[] = [{ type: "text", text: m.content }];
      for (const url of m.imageDataUrls) {
        parts.push({ type: "image_url", image_url: { url } });
      }
      out.push({ role: "user", content: parts });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/** What we know about a person we're calling. */
export interface CallerInfo {
  name: string | null;
  background: string;
  summary: string;
}

export interface AiClient {
  embed(text: string): Promise<number[]>;
  chat(input: {
    system: string;
    messages: ChatMessage[];
    chatId?: string;
    /** Looks up what we know about a person by email (DB-backed, supplied by the route). */
    lookupPerson?: (email: string) => Promise<CallerInfo | null>;
    /** Persists per-agent settings after create_retell_voice_agent (DB-backed). */
    saveAgentSettings?: (agentId: string, settings: { noPickupSms: string }) => Promise<void>;
  }): AsyncIterable<string>;
  complete(prompt: string): Promise<string>;
}

/** Tool: create a new voice agent on RetellAI. */
const CREATE_AGENT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_retell_voice_agent",
    description:
      "Create a voice agent on RetellAI. Only call after you have drafted a complete agent_prompt and the user has approved it.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name for the agent." },
        agent_prompt: {
          type: "string",
          description:
            "The complete system prompt for the voice agent: persona, goal, step-by-step call flow, and guardrails (silence/no-response, sensitive or compensation questions, objections, voicemail, scheduling, and exact end-call conditions).",
        },
        greeting: { type: "string", description: "The first line the agent speaks." },
        voice_id: { type: "string" },
        no_pickup_sms: {
          type: "string",
          description:
            "Optional SMS to send the callee if the call doesn't connect (no answer, busy, voicemail, dial failed). May use {{caller_name}}, {{position}}, {{company_name}} — they'll be filled at send time.",
        },
      },
      required: ["name", "agent_prompt", "greeting", "voice_id"],
    },
  },
};

/** Tool: place an outbound phone call with an existing agent. */
const PLACE_CALL_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "place_phone_call",
    description:
      "Place an outbound phone call: have a Retell agent call a phone number. Only call when the user explicitly asks to call/dial someone and has provided the destination number.",
    parameters: {
      type: "object",
      properties: {
        from_number: {
          type: "string",
          description:
            "The Retell-registered number to call FROM, in E.164 format. Omit to use the server's configured default number.",
        },
        to_number: {
          type: "string",
          description: "The number to call, in E.164 format (e.g. +37491452889).",
        },
        agent_id: {
          type: "string",
          description:
            "Optional id of the agent that should handle the call. Omit to use the agent already assigned to from_number.",
        },
        person_email: {
          type: "string",
          description:
            "Email of the person being called — used to track engagement and look them up. Ask the user for it before dialing.",
        },
        caller_name: {
          type: "string",
          description: "The person's name (from lookup_person, or ask the user on a first interaction).",
        },
        caller_background: {
          type: "string",
          description:
            "What the user told you about this person on a first interaction (only needed the first time; it gets saved).",
        },
        caller_context: {
          type: "string",
          description:
            "What the agent should know about this person going in (their background plus engagement summary). Fills {{caller_context}}.",
        },
        position: {
          type: "string",
          description: "For interviews: the role/position this call is about. Fills {{position}}.",
        },
        position_details: {
          type: "string",
          description:
            "For interviews: the job details (responsibilities, requirements). Fills {{position_details}}.",
        },
        company_name: {
          type: "string",
          description:
            "The company the agent represents. Extract it from the agent/call description if mentioned; otherwise ask the user. Fills {{company_name}}.",
        },
        questions: {
          type: "string",
          description:
            "Specific questions for this call, only when the agent expects per-call questions ({{questions}}) — e.g. technical questions that vary by role. Fills {{questions}}.",
        },
      },
      required: ["to_number"],
    },
  },
};

/** Tool: hang up an ongoing phone call. */
const END_CALL_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "end_phone_call",
    description:
      "Hang up an ongoing phone call. Use when the user asks to end, stop, or disconnect a call.",
    parameters: {
      type: "object",
      properties: {
        call_id: {
          type: "string",
          description:
            "The id of the call to end (from place_phone_call). Omit to end the most recent ongoing call.",
        },
      },
      required: [],
    },
  },
};

/** Tool: list the account's agents so the user can pick one. */
const LIST_AGENTS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "list_agents",
    description:
      "List the voice agents on this RetellAI account (name + id). Use it to let the user choose which agent should place a call.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/** Tool: look up what we already know about a person by email. */
const LOOKUP_PERSON_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "lookup_person",
    description:
      "Look up a person by email to see if we've spoken before. Returns their name, background, and engagement summary, or says it's a first interaction. Call this before placing an interview/engagement call.",
    parameters: {
      type: "object",
      properties: { email: { type: "string", description: "The person's email." } },
      required: ["email"],
    },
  },
};

/** All tools available to the model. */
const TOOLS = [CREATE_AGENT_TOOL, PLACE_CALL_TOOL, END_CALL_TOOL, LIST_AGENTS_TOOL, LOOKUP_PERSON_TOOL];

/** A single tool call the model asked for, as returned on a chat message. */
type ToolCall = NonNullable<OpenAI.Chat.Completions.ChatCompletionMessage["tool_calls"]>[number];

/**
 * Run a tool call the model requested and return its result as text.
 * Never throws: an unknown tool or a failure becomes text the model can read
 * and explain to the user (e.g. "I couldn't create the agent…").
 */
/** Dependencies tool execution needs, supplied per request by the route. */
export interface ToolDeps {
  retell: RetellClient;
  chatId?: string;
  lookupPerson?: (email: string) => Promise<CallerInfo | null>;
  /** Persist per-agent settings (e.g. the SMS to send on no pickup). */
  saveAgentSettings?: (agentId: string, settings: { noPickupSms: string }) => Promise<void>;
}

export async function runToolCall(deps: ToolDeps, call: ToolCall): Promise<string> {
  const { retell } = deps;
  try {
    const args = JSON.parse(call.function.arguments || "{}");
    switch (call.function.name) {
      case "create_retell_voice_agent": {
        const { agentId } = await retell.createVoiceAgent({
          name: String(args.name),
          systemPrompt: String(args.agent_prompt),
          greeting: String(args.greeting),
          voiceId: String(args.voice_id),
        });
        if (args.no_pickup_sms && deps.saveAgentSettings) {
          await deps.saveAgentSettings(agentId, { noPickupSms: String(args.no_pickup_sms) });
        }
        return `Created Retell agent "${String(args.name)}" — agent_id ${agentId}.`;
      }
      case "place_phone_call": {
        const metadata: Record<string, unknown> = {};
        if (deps.chatId) metadata.chatId = deps.chatId;
        if (args.person_email) metadata.email = String(args.person_email);
        if (args.caller_name) metadata.name = String(args.caller_name);
        if (args.caller_background) metadata.background = String(args.caller_background);

        // Values that fill {{placeholders}} in the agent's prompt for this call.
        const vars: Record<string, string> = {};
        for (const key of [
          "position",
          "position_details",
          "caller_name",
          "caller_context",
          "company_name",
          "questions",
        ] as const) {
          if (args[key]) vars[key] = String(args[key]);
        }

        const { callId } = await retell.createPhoneCall({
          fromNumber: String(args.from_number ?? env.RETELL_FROM_NUMBER ?? ""),
          toNumber: String(args.to_number),
          agentId: args.agent_id ? String(args.agent_id) : undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          dynamicVariables: Object.keys(vars).length > 0 ? vars : undefined,
        });
        return `Started outbound call to ${String(args.to_number)} — call_id ${callId}.`;
      }
      case "end_phone_call": {
        if (args.call_id) {
          await retell.stopCall(String(args.call_id));
          return `Ended call ${String(args.call_id)}.`;
        }
        const callId = await retell.stopLatestOngoingCall();
        return `Ended the most recent ongoing call (${callId}).`;
      }
      case "list_agents": {
        const agents = await retell.listAgents();
        if (agents.length === 0) return "No agents found on this account.";
        return "Available agents:\n" + agents.map((a) => `- ${a.name} (${a.agentId})`).join("\n");
      }
      case "lookup_person": {
        const email = String(args.email ?? "").trim().toLowerCase();
        if (!email || !deps.lookupPerson) return "No record found.";
        const info = await deps.lookupPerson(email);
        if (!info) {
          return `First interaction with ${email} — no record yet. Ask the user for the person's name and any background about them.`;
        }
        return `Known contact ${email}: name=${info.name ?? "unknown"}; background=${info.background || "none"}; engagement summary=${info.summary || "none"}.`;
      }
      default:
        return `Unknown tool: ${call.function.name}`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function createOpenAiClient(apiKey: string, retell: RetellClient): AiClient {
  const openai = new OpenAI({ apiKey });

  return {
    async embed(text: string): Promise<number[]> {
      const res = await openai.embeddings.create({
        model: env.EMBEDDING_MODEL,
        input: text,
      });
      return res.data[0].embedding;
    },

    async *chat({
      system,
      messages,
      chatId,
      lookupPerson,
      saveAgentSettings,
    }: {
      system: string;
      messages: ChatMessage[];
      chatId?: string;
      lookupPerson?: (email: string) => Promise<CallerInfo | null>;
      saveAgentSettings?: (agentId: string, settings: { noPickupSms: string }) => Promise<void>;
    }): AsyncGenerator<string> {
      const convo = toOpenAiMessages(system, messages) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      const deps: ToolDeps = { retell, chatId, lookupPerson, saveAgentSettings };

      // Stream the reply token-by-token. The model may chain tools (e.g.
      // lookup_person → place_phone_call) before answering, so loop: stream any
      // text, run any requested tools, then ask again. Bounded to avoid runaway.
      for (let round = 0; round < 5; round++) {
        const stream = await openai.chat.completions.create({
          model: env.CHAT_MODEL,
          messages: convo,
          tools: TOOLS,
          stream: true,
        });

        // Tool-call fragments arrive split across chunks; reassemble them by index.
        const toolCalls: Record<number, { id: string; name: string; args: string }> = {};
        let text = "";
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            text += delta.content;
            yield delta.content;
          }
          for (const tc of delta?.tool_calls ?? []) {
            const c = (toolCalls[tc.index] ??= { id: "", name: "", args: "" });
            if (tc.id) c.id = tc.id;
            if (tc.function?.name) c.name += tc.function.name;
            if (tc.function?.arguments) c.args += tc.function.arguments;
          }
        }

        const calls = Object.values(toolCalls).map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.args },
        }));
        if (calls.length === 0) return; // model answered; already streamed

        convo.push({ role: "assistant", content: text || null, tool_calls: calls });
        for (const call of calls) {
          const result = await runToolCall(deps, call);
          convo.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      }
    },

    async complete(prompt: string): Promise<string> {
      const res = await openai.chat.completions.create({
        model: env.CHAT_MODEL,
        messages: [{ role: "user", content: prompt }],
      });
      return res.choices[0].message.content ?? "";
    },
  };
}
