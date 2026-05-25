import { describe, it, expect, vi } from "vitest";
import type { ToolDefinition } from "../client.js";

describe("ToolDefinition", () => {
  it("runs its handler and returns a string result", async () => {
    const run = vi.fn(async (args: Record<string, unknown>) => `ran with ${args.x}`);
    const tool: ToolDefinition = {
      name: "t",
      description: "d",
      parameters: { type: "object", properties: { x: { type: "number" } } },
      run,
    };

    const result = await tool.run({ x: 1 });
    expect(result).toBe("ran with 1");
    expect(run).toHaveBeenCalledWith({ x: 1 });
  });
});
