import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { prisma } from "../../db.js";
import { createFakeAi } from "../../ai/fakeAi.js";
import { addMemory, searchMemories } from "../store.js";
import { randomUUID } from "crypto";

// User identity now comes from Clerk — userId is a free-form string with no
// local User table/FK, so tests use plain ids directly.
const USER1_ID = `test-mem-user1-${randomUUID()}`;
const USER2_ID = `test-mem-user2-${randomUUID()}`;

async function cleanup() {
  await prisma.memory.deleteMany({ where: { userId: { in: [USER1_ID, USER2_ID] } } });
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("addMemory + searchMemories", () => {
  it("stores a memory and retrieves it for the correct user", async () => {
    const ai = createFakeAi();
    await addMemory(ai, USER1_ID, "User likes hiking");
    const results = await searchMemories(ai, USER1_ID, "outdoors", 5);
    expect(results).toContain("User likes hiking");
  });

  it("scopes memories per user — user2 memory not visible to user1", async () => {
    const ai = createFakeAi();
    await addMemory(ai, USER2_ID, "User2 secret fact");
    const user1Results = await searchMemories(ai, USER1_ID, "secret", 5);
    expect(user1Results).not.toContain("User2 secret fact");
    const user2Results = await searchMemories(ai, USER2_ID, "secret", 5);
    expect(user2Results).toContain("User2 secret fact");
  });

  it("does not insert a duplicate row for the same (userId, content)", async () => {
    const ai = createFakeAi();
    const content = `duplicate fact ${randomUUID()}`;
    await addMemory(ai, USER1_ID, content);
    await addMemory(ai, USER1_ID, content);
    const count = await prisma.memory.count({ where: { userId: USER1_ID, content } });
    expect(count).toBe(1);
  });
});
