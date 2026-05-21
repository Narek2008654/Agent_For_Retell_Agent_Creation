import type { AiClient, ChatMessage } from "./client.js";

/**
 * Deterministic hash of a string → a 32-bit integer seed.
 * Uses djb2 algorithm.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep as unsigned 32-bit
  }
  return h;
}

/**
 * Simple mulberry32 PRNG seeded from a 32-bit integer.
 * Returns a function that produces a float in [0, 1).
 */
function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a deterministic fake AiClient for use in tests.
 * Accepts optional overrides for any method.
 */
export function createFakeAi(overrides?: Partial<AiClient>): AiClient {
  const base: AiClient = {
    async embed(text: string): Promise<number[]> {
      const seed = hashString(text);
      const rand = makePrng(seed);
      return Array.from({ length: 1536 }, () => rand() * 2 - 1);
    },

    async *streamChat(_input: {
      system: string;
      messages: ChatMessage[];
    }): AsyncGenerator<string> {
      const canned = ["Hello", " from", " the", " fake", " AI", "."];
      for (const chunk of canned) {
        yield chunk;
      }
    },

    async complete(_prompt: string): Promise<string> {
      return "[]";
    },
  };

  return { ...base, ...overrides };
}
