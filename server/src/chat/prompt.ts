import type { ChatMessage } from "../ai/client.js";

const BASE_SYSTEM = `You are a helpful, friendly assistant. Answer clearly and concisely.`;

export function buildPrompt(input: {
  facts: string[];
  history: ChatMessage[];
  message: string;
}): { system: string; messages: ChatMessage[] } {
  const { facts, history, message } = input;

  let system = BASE_SYSTEM;
  if (facts.length > 0) {
    const bullets = facts.map((f) => `- ${f}`).join("\n");
    system += `\n\nWhat you know about the user:\n${bullets}`;
  }

  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: message },
  ];

  return { system, messages };
}
