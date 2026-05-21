import { describe, it, expect } from "vitest";
import { createFakeAi } from "../fakeAi.js";

describe("createFakeAi", () => {
  it("embed returns a vector of length 1536", async () => {
    const ai = createFakeAi();
    const vec = await ai.embed("hello world");
    expect(vec).toHaveLength(1536);
  });

  it("embed is deterministic — same input yields same vector", async () => {
    const ai = createFakeAi();
    const v1 = await ai.embed("deterministic test");
    const v2 = await ai.embed("deterministic test");
    expect(v1).toEqual(v2);
  });

  it("embed returns different vectors for different inputs", async () => {
    const ai = createFakeAi();
    const v1 = await ai.embed("foo");
    const v2 = await ai.embed("bar");
    expect(v1).not.toEqual(v2);
  });

  it("streamChat yields at least one chunk and concatenation is a non-empty string", async () => {
    const ai = createFakeAi();
    const chunks: string[] = [];
    for await (const chunk of ai.streamChat({ system: "sys", messages: [] })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join("")).not.toBe("");
  });

  it("complete returns a string (default: '[]')", async () => {
    const ai = createFakeAi();
    const result = await ai.complete("some prompt");
    expect(typeof result).toBe("string");
    expect(result).toBe("[]");
  });

  it("overrides.complete is respected", async () => {
    const ai = createFakeAi({ complete: async () => '["User is named Sam"]' });
    const result = await ai.complete("some prompt");
    expect(result).toBe('["User is named Sam"]');
  });

  it("overrides.embed is respected", async () => {
    const fixedVec = Array(1536).fill(0.5);
    const ai = createFakeAi({ embed: async () => fixedVec });
    const result = await ai.embed("anything");
    expect(result).toEqual(fixedVec);
  });
});
