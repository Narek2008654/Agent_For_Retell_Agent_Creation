import OpenAI from "openai";
import { env } from "../env.js";

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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the arguments
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface AiClient {
  embed(text: string): Promise<number[]>;
  streamChat(input: {
    system: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): AsyncIterable<string>;
  complete(prompt: string): Promise<string>;
}

export function createOpenAiClient(apiKey: string): AiClient {
  const openai = new OpenAI({ apiKey });

  return {
    async embed(text: string): Promise<number[]> {
      const res = await openai.embeddings.create({
        model: env.EMBEDDING_MODEL,
        input: text,
      });
      return res.data[0].embedding;
    },

    async *streamChat({
      system,
      messages,
      tools,
    }: {
      system: string;
      messages: ChatMessage[];
      tools?: ToolDefinition[];
    }): AsyncGenerator<string> {
      const oaTools = tools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      const convo = toOpenAiMessages(system, messages) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

      // Loop so the model can call tools and then produce a final answer.
      // Capped to avoid runaway tool loops.
      for (let iteration = 0; iteration < 3; iteration++) {
        const stream = await openai.chat.completions.create({
          model: env.CHAT_MODEL,
          messages: convo,
          tools: oaTools,
          stream: true,
        });

        const toolCalls: Record<number, { id: string; name: string; args: string }> = {};
        let assistantText = "";
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            assistantText += delta.content;
            yield delta.content;
          }
          for (const tc of delta?.tool_calls ?? []) {
            const call = (toolCalls[tc.index] ??= { id: "", name: "", args: "" });
            if (tc.id) call.id = tc.id;
            if (tc.function?.name) call.name += tc.function.name;
            if (tc.function?.arguments) call.args += tc.function.arguments;
          }
        }

        const calls = Object.values(toolCalls);
        if (calls.length === 0) return; // plain answer; already streamed

        convo.push({
          role: "assistant",
          content: assistantText || null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.args },
          })),
        });

        for (const c of calls) {
          const tool = tools?.find((t) => t.name === c.name);
          let result: string;
          try {
            result = tool ? await tool.run(JSON.parse(c.args || "{}")) : `Unknown tool: ${c.name}`;
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          convo.push({ role: "tool", tool_call_id: c.id, content: result });
        }
        // Next iteration streams the follow-up (user-facing) reply.
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
