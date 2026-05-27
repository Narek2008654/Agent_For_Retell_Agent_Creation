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

export interface AiClient {
  embed(text: string): Promise<number[]>;
  chat(input: { system: string; messages: ChatMessage[]; chatId?: string }): Promise<string>;
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

/** All tools available to the model. */
const TOOLS = [CREATE_AGENT_TOOL, PLACE_CALL_TOOL, END_CALL_TOOL, LIST_AGENTS_TOOL];

/** A single tool call the model asked for, as returned on a chat message. */
type ToolCall = NonNullable<OpenAI.Chat.Completions.ChatCompletionMessage["tool_calls"]>[number];

/**
 * Run a tool call the model requested and return its result as text.
 * Never throws: an unknown tool or a failure becomes text the model can read
 * and explain to the user (e.g. "I couldn't create the agent…").
 */
export async function runToolCall(
  retell: RetellClient,
  call: ToolCall,
  chatId?: string,
): Promise<string> {
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
        return `Created Retell agent "${String(args.name)}" — agent_id ${agentId}.`;
      }
      case "place_phone_call": {
        const { callId } = await retell.createPhoneCall({
          fromNumber: String(args.from_number ?? env.RETELL_FROM_NUMBER ?? ""),
          toNumber: String(args.to_number),
          agentId: args.agent_id ? String(args.agent_id) : undefined,
          metadata: chatId ? { chatId } : undefined,
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

    async chat({
      system,
      messages,
      chatId,
    }: {
      system: string;
      messages: ChatMessage[];
      chatId?: string;
    }): Promise<string> {
      const convo = toOpenAiMessages(system, messages) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

      // The model may chain tools (e.g. list_agents → place_phone_call) before
      // answering, so loop: run any requested tools and ask again until it
      // returns plain text. Bounded to avoid runaway tool loops.
      for (let round = 0; round < 5; round++) {
        const res = await openai.chat.completions.create({
          model: env.CHAT_MODEL,
          messages: convo,
          tools: TOOLS,
        });
        const message = res.choices[0].message;

        // No tool calls → the model answered directly.
        if (!message.tool_calls || message.tool_calls.length === 0) {
          return message.content ?? "";
        }

        convo.push(message);
        for (const call of message.tool_calls) {
          const result = await runToolCall(retell, call, chatId);
          convo.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      }

      // Tool loop exhausted without producing a plain answer.
      return "";
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
