import type { AiClient } from "../ai/client.js";

const MAX_TITLE_LENGTH = 60;

function buildTitlePrompt(firstMessage: string): string {
  return `Generate a short, descriptive title for a conversation that begins with the message below.
Rules: 3-6 words, no surrounding quotes, no trailing punctuation. Respond with ONLY the title.

Message:
${firstMessage}`;
}

/** Cap a string at MAX_TITLE_LENGTH, appending an ellipsis if it was cut. */
function truncate(text: string): string {
  if (text.length <= MAX_TITLE_LENGTH) return text;
  return text.slice(0, MAX_TITLE_LENGTH).trimEnd() + "…";
}

/** A usable title derived directly from the user's message, when the model can't produce one. */
function fallbackTitle(firstMessage: string): string {
  const cleaned = firstMessage.trim().replace(/\s+/g, " ");
  return cleaned ? truncate(cleaned) : "New chat";
}

/** Normalize a model-produced title: first line, no wrapping quotes, no trailing punctuation. */
function cleanTitle(raw: string): string {
  const firstLine = raw.trim().split("\n")[0] ?? "";
  return truncate(
    firstLine
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Generate a concise conversation title from the user's first message, the way
 * ChatGPT does: a cheap, separate model call that summarizes the opening message
 * into a few words. Falls back to a truncated version of the message if the model
 * returns nothing usable. Never throws on empty/garbage output.
 */
export async function generateChatTitle(ai: AiClient, firstMessage: string): Promise<string> {
  const title = cleanTitle(await ai.complete(buildTitlePrompt(firstMessage)));
  return /[a-z0-9]/i.test(title) ? title : fallbackTitle(firstMessage);
}
