import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";
import { fakeAuth } from "../test/fakeAuth.js";

const USER = "user_test_webhook";

const app = createApp({
  ai: createFakeAi({ complete: async () => "Caller confirmed the interview for Tuesday at 3pm." }),
  requireAuth: fakeAuth,
});

async function cleanup() {
  await prisma.chat.deleteMany({ where: { userId: USER } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function createChat(): Promise<string> {
  const res = await request(app).post("/api/chats").set("x-test-user-id", USER).send({ title: "Call" });
  return res.body.id;
}

test("call_ended webhook posts a summary message into the chat from metadata", async () => {
  const chatId = await createChat();

  const res = await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: {
        call_id: "call_1",
        start_timestamp: 1_000,
        end_timestamp: 84_000, // 83s -> "1m 23s"
        disconnection_reason: "user_hangup",
        transcript: "Agent: Hi!\nUser: I'm free Tuesday.\nAgent: Great, booked.",
        metadata: { chatId },
      },
    });

  expect(res.status).toBe(200);

  const msgs = await prisma.message.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });
  const last = msgs[msgs.length - 1];
  expect(last.role).toBe("assistant");
  expect(last.content).toContain("1m 23s");
  expect(last.content).toContain("user_hangup");
  expect(last.content).toContain("Caller confirmed the interview");
});

test("a failed (no-transcript) call reports that it didn't connect", async () => {
  const chatId = await createChat();

  await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: { call_id: "c2", disconnection_reason: "dial_failed", metadata: { chatId } },
    });

  const msgs = await prisma.message.findMany({ where: { chatId } });
  expect(msgs[0].content).toContain("dial_failed");
  expect(msgs[0].content).toContain("didn't connect");
});

test("non-call_ended events are acknowledged but post nothing", async () => {
  const chatId = await createChat();

  const res = await request(app)
    .post("/api/retell/webhook")
    .send({ event: "call_started", call: { call_id: "c3", metadata: { chatId } } });

  expect(res.status).toBe(200);
  expect(await prisma.message.count({ where: { chatId } })).toBe(0);
});

test("calls with no chat metadata are ignored (still 200)", async () => {
  const res = await request(app)
    .post("/api/retell/webhook")
    .send({ event: "call_ended", call: { call_id: "c4", disconnection_reason: "dial_failed" } });

  expect(res.status).toBe(200);
});
