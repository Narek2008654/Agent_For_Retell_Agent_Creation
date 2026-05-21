import OpenAI from "openai";
import { env } from "../env.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiClient {
  embed(text: string): Promise<number[]>;
  streamChat(input: {
    system: string;
    messages: ChatMessage[];
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
    }: {
      system: string;
      messages: ChatMessage[];
    }): AsyncGenerator<string> {
      const stream = await openai.chat.completions.create({
        model: env.CHAT_MODEL,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          yield delta;
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
