import { describe, it, expect } from "vitest";
import { createFakeAi } from "../../ai/fakeAi.js";
import { generateChatTitle } from "../title.js";

describe("generateChatTitle", () => {
  it("returns the model's title", async () => {
    const ai = createFakeAi({ complete: async () => "Trip to Japan" });
    expect(await generateChatTitle(ai, "Help me plan a trip to Japan")).toBe("Trip to Japan");
  });

  it("strips surrounding quotes", async () => {
    const ai = createFakeAi({ complete: async () => '"Weekend Plans"' });
    expect(await generateChatTitle(ai, "what should I do this weekend")).toBe("Weekend Plans");
  });

  it("removes trailing punctuation", async () => {
    const ai = createFakeAi({ complete: async () => "Dinner Ideas." });
    expect(await generateChatTitle(ai, "dinner ideas")).toBe("Dinner Ideas");
  });

  it("uses only the first line of a multi-line response", async () => {
    const ai = createFakeAi({ complete: async () => "Budget Planning\nHere is your title" });
    expect(await generateChatTitle(ai, "help me budget")).toBe("Budget Planning");
  });

  it("truncates an over-long title", async () => {
    const longTitle = "A".repeat(120);
    const ai = createFakeAi({ complete: async () => longTitle });
    const result = await generateChatTitle(ai, "x");
    expect(result.length).toBeLessThanOrEqual(61); // 60 + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });

  it("falls back to the first message when the model returns nothing usable", async () => {
    const ai = createFakeAi({ complete: async () => "   " });
    expect(await generateChatTitle(ai, "Fix my login bug")).toBe("Fix my login bug");
  });

  it("falls back when the model returns no alphanumeric content", async () => {
    const ai = createFakeAi({ complete: async () => "[]" });
    expect(await generateChatTitle(ai, "hello there")).toBe("hello there");
  });

  it("falls back to a truncated message when the message is very long", async () => {
    const ai = createFakeAi({ complete: async () => "" });
    const longMessage = "word ".repeat(40).trim();
    const result = await generateChatTitle(ai, longMessage);
    expect(result.length).toBeLessThanOrEqual(61);
    expect(result.endsWith("…")).toBe(true);
  });
});
