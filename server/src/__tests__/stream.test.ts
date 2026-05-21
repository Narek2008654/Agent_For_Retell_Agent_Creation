import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";

const fakeAi = createFakeAi();
const app = createApp({ ai: fakeAi });

const USER1_EMAIL = "stream-test-user1@example-test.invalid";
const USER2_EMAIL = "stream-test-user2@example-test.invalid";
const PASSWORD = "password123";
const NAME = "StreamUser";

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
let chatId: string;

beforeAll(async () => {
  await cleanupTestUsers();
  cookie1 = await signUp(USER1_EMAIL);
  cookie2 = await signUp(USER2_EMAIL);

  // Create a chat for user1
  const chatRes = await request(app)
    .post("/api/chats")
    .set("Cookie", cookie1)
    .send({ title: "Stream Test Chat" });
  chatId = chatRes.body.id;
});

afterAll(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
});

test("POST /api/chats/:id/stream returns text/event-stream with fake AI chunks and done event", async () => {
  const res = await request(app)
    .post(`/api/chats/${chatId}/stream`)
    .set("Cookie", cookie1)
    .send({ content: "hi" });

  expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  expect(res.text).toContain("Hello");
  expect(res.text).toContain(" from");
  expect(res.text).toContain("event: done");
});

test("POST /api/chats/:id/stream saves user and assistant messages in DB", async () => {
  // Create a fresh chat to isolate message counts
  const chatRes = await request(app)
    .post("/api/chats")
    .set("Cookie", cookie1)
    .send({ title: "Message Count Chat" });
  const isolatedChatId = chatRes.body.id;

  await request(app)
    .post(`/api/chats/${isolatedChatId}/stream`)
    .set("Cookie", cookie1)
    .send({ content: "hi" });

  const msgs = await prisma.message.findMany({
    where: { chatId: isolatedChatId },
    orderBy: { createdAt: "asc" },
  });

  expect(msgs).toHaveLength(2);
  expect(msgs[0].role).toBe("user");
  expect(msgs[0].content).toBe("hi");
  expect(msgs[1].role).toBe("assistant");
  expect(msgs[1].content).toBe("Hello from the fake AI.");
});

test("POST /api/chats/:id/stream returns 404 when user2 tries to stream to user1's chat", async () => {
  const res = await request(app)
    .post(`/api/chats/${chatId}/stream`)
    .set("Cookie", cookie2)
    .send({ content: "sneaky" });

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: "not found" });
});
