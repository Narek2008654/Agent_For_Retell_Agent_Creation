import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";
import { addMemory } from "../memory/store.js";

const fakeAi = createFakeAi();
const app = createApp({ ai: fakeAi });

const USER1_EMAIL = "memory-route-user1@example-test.invalid";
const USER2_EMAIL = "memory-route-user2@example-test.invalid";
const PASSWORD = "password123";
const NAME = "MemUser";

async function signUp(email: string): Promise<string[]> {
  const res = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ email, password: PASSWORD, name: NAME });
  const rawCookies = res.headers["set-cookie"];
  const cookies: string[] = Array.isArray(rawCookies)
    ? rawCookies
    : [rawCookies as string];
  return cookies;
}

async function cleanupTestUsers() {
  await prisma.user.deleteMany({
    where: { email: { in: [USER1_EMAIL, USER2_EMAIL] } },
  });
}

let cookie1: string[];
let cookie2: string[];
let user1Id: string;

beforeAll(async () => {
  await cleanupTestUsers();
  cookie1 = await signUp(USER1_EMAIL);
  cookie2 = await signUp(USER2_EMAIL);

  const user1 = await prisma.user.findUniqueOrThrow({
    where: { email: USER1_EMAIL },
  });
  user1Id = user1.id;
});

afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

test("GET /api/memory lists the authenticated user's memories", async () => {
  await addMemory(fakeAi, user1Id, "User1 likes cats");
  await addMemory(fakeAi, user1Id, "User1 lives in Paris");

  const res = await request(app)
    .get("/api/memory")
    .set("Cookie", cookie1);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  const contents = res.body.map((m: { content: string }) => m.content);
  expect(contents).toContain("User1 likes cats");
  expect(contents).toContain("User1 lives in Paris");
});

test("GET /api/memory does not return another user's memories", async () => {
  const res = await request(app)
    .get("/api/memory")
    .set("Cookie", cookie2);

  expect(res.status).toBe(200);
  const contents = res.body.map((m: { content: string }) => m.content);
  expect(contents).not.toContain("User1 likes cats");
  expect(contents).not.toContain("User1 lives in Paris");
});

test("DELETE /api/memory/:id removes the memory for the owner", async () => {
  await addMemory(fakeAi, user1Id, "Fact to delete");

  // Find the memory just added
  const memories = await prisma.memory.findMany({
    where: { userId: user1Id, content: "Fact to delete" },
  });
  expect(memories.length).toBeGreaterThan(0);
  const memId = memories[0].id;

  const res = await request(app)
    .delete(`/api/memory/${memId}`)
    .set("Cookie", cookie1);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });

  const row = await prisma.memory.findUnique({ where: { id: memId } });
  expect(row).toBeNull();
});

test("DELETE /api/memory/:id returns 404 when another user tries to delete", async () => {
  await addMemory(fakeAi, user1Id, "Protected fact");

  const memories = await prisma.memory.findMany({
    where: { userId: user1Id, content: "Protected fact" },
  });
  const memId = memories[0].id;

  const res = await request(app)
    .delete(`/api/memory/${memId}`)
    .set("Cookie", cookie2);

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: "not found" });

  // Row still exists
  const row = await prisma.memory.findUnique({ where: { id: memId } });
  expect(row).not.toBeNull();
});
