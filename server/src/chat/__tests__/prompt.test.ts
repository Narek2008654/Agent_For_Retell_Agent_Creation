import { describe, it, expect } from "vitest";
import { buildPrompt } from "../prompt.js";
import type { ChatMessage } from "../../ai/client.js";

describe("buildPrompt", () => {
  const history: ChatMessage[] = [{ role: "assistant", content: "hi" }];

  it("includes known facts in the system prompt", () => {
    const { system } = buildPrompt({
      facts: ["User is named Sam"],
      history,
      message: "hello",
    });
    expect(system).toContain("Sam");
    expect(system).toContain("What you know about the user");
  });

  it("appends the user message at the end of messages array", () => {
    const { messages } = buildPrompt({
      facts: ["User is named Sam"],
      history,
      message: "hello",
    });
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
    expect(messages).toHaveLength(history.length + 1);
  });

  it("preserves history in messages before the new user message", () => {
    const { messages } = buildPrompt({
      facts: [],
      history,
      message: "hello",
    });
    expect(messages[0]).toEqual(history[0]);
  });

  it("does NOT include memory header when facts is empty", () => {
    const { system } = buildPrompt({
      facts: [],
      history: [],
      message: "hello",
    });
    expect(system).not.toContain("What you know about the user");
  });

  it("lists every fact as a bullet point", () => {
    const { system } = buildPrompt({
      facts: ["Likes hiking", "Lives in NYC"],
      history: [],
      message: "hi",
    });
    expect(system).toContain("- Likes hiking");
    expect(system).toContain("- Lives in NYC");
  });
});
