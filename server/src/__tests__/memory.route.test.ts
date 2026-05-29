import request from "supertest";
import type { Express } from "express";
import type { INestApplication } from "@nestjs/common";
import { createTestServer } from "../test/createTestServer.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";
import { fakeAuth } from "../test/fakeAuth.js";
import { addMemory } from "../memory/store.js";

const fakeAi = createFakeAi();
let express: Express;
let nest: INestApplication;

const USER1 = "user_test_mem_1";
const USER2 = "user_test_mem_2";

async function cleanup() {
  await prisma.memory.deleteMany({ where: { userId: { in: [USER1, USER2] } } });
}

beforeAll(async () => {
  await cleanup();
  ({ express, nest } = await createTestServer({ ai: fakeAi, requireAuth: fakeAuth }));
});

afterAll(async () => {
  await nest.close();
  await cleanup();
  await prisma.$disconnect();
});

test("GET /api/memory lists the authenticated user's memories", async () => {
  await addMemory(fakeAi, USER1, "User1 likes cats");
  await addMemory(fakeAi, USER1, "User1 lives in Paris");

  const res = await request(express).get("/api/memory").set("x-test-user-id", USER1);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  const contents = res.body.map((m: { content: string }) => m.content);
  expect(contents).toContain("User1 likes cats");
  expect(contents).toContain("User1 lives in Paris");
});

test("GET /api/memory does not return another user's memories", async () => {
  const res = await request(express).get("/api/memory").set("x-test-user-id", USER2);

  expect(res.status).toBe(200);
  const contents = res.body.map((m: { content: string }) => m.content);
  expect(contents).not.toContain("User1 likes cats");
  expect(contents).not.toContain("User1 lives in Paris");
});

test("DELETE /api/memory/:id removes the memory for the owner", async () => {
  await addMemory(fakeAi, USER1, "Fact to delete");

  const memories = await prisma.memory.findMany({
    where: { userId: USER1, content: "Fact to delete" },
  });
  expect(memories.length).toBeGreaterThan(0);
  const memId = memories[0].id;

  const res = await request(express)
    .delete(`/api/memory/${memId}`)
    .set("x-test-user-id", USER1);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });

  const row = await prisma.memory.findUnique({ where: { id: memId } });
  expect(row).toBeNull();
});

test("DELETE /api/memory/:id returns 404 when another user tries to delete", async () => {
  await addMemory(fakeAi, USER1, "Protected fact");

  const memories = await prisma.memory.findMany({
    where: { userId: USER1, content: "Protected fact" },
  });
  const memId = memories[0].id;

  const res = await request(express)
    .delete(`/api/memory/${memId}`)
    .set("x-test-user-id", USER2);

  expect(res.status).toBe(404);
  expect(res.body.message).toBe("Not Found");

  // Row still exists
  const row = await prisma.memory.findUnique({ where: { id: memId } });
  expect(row).not.toBeNull();
});
