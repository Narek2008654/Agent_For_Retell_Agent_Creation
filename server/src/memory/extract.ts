import type { AiClient } from "../ai/client.js";

/**
 * Build the extraction prompt asking the model to identify durable user facts.
 */
function buildExtractionPrompt(
  userMessage: string,
  assistantMessage: string
): string {
  return `You are a memory extraction assistant. Analyze the following conversation exchange and identify any durable, user-specific facts worth remembering long-term (e.g. the user's name, preferences, hobbies, location, or other stable personal context).

Return ONLY a JSON array of short fact strings. If there are no memorable facts, return an empty array: [].
Do NOT include any explanation or markdown — just the raw JSON array.

User: ${userMessage}
Assistant: ${assistantMessage}`;
}

/**
 * Strip optional ```json ... ``` fences from the model's response.
 */
function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Extract durable user facts from a single chat exchange.
 * Returns [] on any parse failure or non-array result.
 */
export async function extractFacts(
  ai: AiClient,
  userMessage: string,
  assistantMessage: string
): Promise<string[]> {
  const prompt = buildExtractionPrompt(userMessage, assistantMessage);
  const raw = await ai.complete(prompt);

  try {
    const cleaned = stripJsonFences(raw);
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[])
      .filter((item): item is string => typeof item === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}
