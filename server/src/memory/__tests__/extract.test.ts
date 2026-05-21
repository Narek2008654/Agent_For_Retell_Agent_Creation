import { describe, it, expect } from "vitest";
import { createFakeAi } from "../../ai/fakeAi.js";
import { extractFacts } from "../extract.js";

describe("extractFacts", () => {
  it("returns [] when fake AI returns default '[]'", async () => {
    const ai = createFakeAi();
    const facts = await extractFacts(ai, "My name is Sam", "Nice to meet you, Sam!");
    expect(facts).toEqual([]);
  });

  it("returns parsed facts when AI returns a JSON array", async () => {
    const ai = createFakeAi({
      complete: async () => '["User is named Sam"]',
    });
    const facts = await extractFacts(ai, "My name is Sam", "Nice to meet you, Sam!");
    expect(facts).toEqual(["User is named Sam"]);
  });

  it("returns [] when AI returns invalid JSON", async () => {
    const ai = createFakeAi({ complete: async () => "not json at all" });
    const facts = await extractFacts(ai, "hello", "hi");
    expect(facts).toEqual([]);
  });

  it("returns [] when AI returns a non-array JSON value", async () => {
    const ai = createFakeAi({ complete: async () => '{"key": "value"}' });
    const facts = await extractFacts(ai, "hello", "hi");
    expect(facts).toEqual([]);
  });

  it("filters out non-string items from the array", async () => {
    const ai = createFakeAi({
      complete: async () => '["Valid fact", 42, null, "Another fact"]',
    });
    const facts = await extractFacts(ai, "hello", "hi");
    expect(facts).toEqual(["Valid fact", "Another fact"]);
  });

  it("strips ```json fences before parsing", async () => {
    const ai = createFakeAi({
      complete: async () => '```json\n["User likes coffee"]\n```',
    });
    const facts = await extractFacts(ai, "I love coffee", "Great choice!");
    expect(facts).toEqual(["User likes coffee"]);
  });

  it("trims whitespace from fact strings", async () => {
    const ai = createFakeAi({
      complete: async () => '[" User is named Sam "]',
    });
    const facts = await extractFacts(ai, "hello", "hi");
    expect(facts).toEqual(["User is named Sam"]);
  });

  it("filters out empty strings after trimming", async () => {
    const ai = createFakeAi({
      complete: async () => '["  ", "User is named Sam"]',
    });
    const facts = await extractFacts(ai, "hello", "hi");
    expect(facts).toEqual(["User is named Sam"]);
  });
});
