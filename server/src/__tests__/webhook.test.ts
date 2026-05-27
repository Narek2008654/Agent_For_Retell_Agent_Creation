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
  await prisma.call.deleteMany({ where: { userId: USER } });
  await prisma.person.deleteMany({ where: { userId: USER } });
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

test("logs the full call and rolls it into the person identified by email", async () => {
  const chatId = await createChat();
  const email = "colleen@example.com";

  await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: {
        call_id: "call_email_1",
        start_timestamp: 0,
        end_timestamp: 30_000,
        disconnection_reason: "user_hangup",
        transcript: "Agent: Hi Colleen.\nUser: Hi there.",
        metadata: { chatId, email },
      },
    });

  const call = await prisma.call.findUnique({ where: { id: "call_email_1" } });
  expect(call?.personEmail).toBe(email);
  expect(call?.transcript).toContain("Colleen");

  const person = await prisma.person.findUnique({ where: { userId_email: { userId: USER, email } } });
  expect(person).not.toBeNull();
  expect(person?.summary).not.toBe("");
  expect(call?.personId).toBe(person?.id);
});

test("is idempotent — a repeated call_id does not double-log", async () => {
  const chatId = await createChat();
  const body = {
    event: "call_ended",
    call: { call_id: "call_dupe", start_timestamp: 0, end_timestamp: 5_000, transcript: "x", metadata: { chatId } },
  };

  await request(app).post("/api/retell/webhook").send(body);
  await request(app).post("/api/retell/webhook").send(body);

  expect(await prisma.call.count({ where: { id: "call_dupe" } })).toBe(1);
});

test("calls with no chat metadata are ignored (still 200)", async () => {
  const res = await request(app)
    .post("/api/retell/webhook")
    .send({ event: "call_ended", call: { call_id: "c4", disconnection_reason: "dial_failed" } });

  expect(res.status).toBe(200);
});
