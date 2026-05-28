import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";
import { createFakeTwilioClient, type SendSmsInput } from "../twilio/client.js";
import { fakeAuth } from "../test/fakeAuth.js";

const USER = "user_test_webhook";

const smsLog: SendSmsInput[] = [];
const app = createApp({
  ai: createFakeAi({ complete: async () => "Caller confirmed the interview for Tuesday at 3pm." }),
  twilio: createFakeTwilioClient({ messages: smsLog }),
  requireAuth: fakeAuth,
});

async function cleanup() {
  smsLog.length = 0;
  await prisma.call.deleteMany({ where: { userId: USER } });
  await prisma.person.deleteMany({ where: { userId: USER } });
  await prisma.agentSettings.deleteMany({ where: { userId: USER } });
  await prisma.chat.deleteMany({ where: { userId: USER } });
}

beforeAll(cleanup);
beforeEach(() => {
  smsLog.length = 0;
});
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

test("captures the person's name and background on first interaction", async () => {
  const chatId = await createChat();
  const email = "newperson@example.com";

  await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: {
        call_id: "call_named_1",
        start_timestamp: 0,
        end_timestamp: 20_000,
        transcript: "Agent: Hi.\nUser: Hello.",
        metadata: { chatId, email, name: "Jane Doe", background: "Referred by a colleague" },
      },
    });

  const person = await prisma.person.findUnique({ where: { userId_email: { userId: USER, email } } });
  expect(person?.name).toBe("Jane Doe");
  expect(person?.background).toBe("Referred by a colleague");
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

test("sends a no-pickup SMS when the call didn't connect and the agent has a template", async () => {
  const chatId = await createChat();
  const agentId = "agent_nopickup_x";
  await prisma.agentSettings.create({
    data: {
      userId: USER,
      agentId,
      noPickupSms: "Hi {{caller_name}}, sorry we missed you about the {{position}} role at {{company_name}}.",
    },
  });

  await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: {
        call_id: "call_nopickup_1",
        agent_id: agentId,
        from_number: "+19018836036",
        to_number: "+37496200819",
        disconnection_reason: "dial_no_answer",
        metadata: { chatId, email: "valer@example.com" },
        retell_llm_dynamic_variables: {
          caller_name: "Valer",
          position: "Technical AI Consultant",
          company_name: "EPAM Armenia",
        },
      },
    });

  expect(smsLog).toHaveLength(1);
  expect(smsLog[0]).toMatchObject({ from: "+19018836036", to: "+37496200819" });
  expect(smsLog[0].body).toBe(
    "Hi Valer, sorry we missed you about the Technical AI Consultant role at EPAM Armenia.",
  );
});

test("picks the followup SMS template when caller_context is non-empty (returning contact)", async () => {
  const chatId = await createChat();
  const agentId = "agent_followup_x";
  await prisma.agentSettings.create({
    data: {
      userId: USER,
      agentId,
      noPickupSms: "Hi {{caller_name}}, interested in {{position}} at {{company_name}}?",
      noPickupSmsFollowup: "Hi {{caller_name}}, sorry we missed you — {{call_reason}}",
    },
  });

  await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: {
        call_id: "call_followup_1",
        agent_id: agentId,
        from_number: "+19018836036",
        to_number: "+37496200819",
        disconnection_reason: "voicemail_reached",
        metadata: { chatId, email: "valer@example.com" },
        retell_llm_dynamic_variables: {
          caller_name: "Valer",
          caller_context: "Already spoke about the AI Consultant role; agreed to follow up.",
          call_reason: "I had a question about your background",
        },
      },
    });

  expect(smsLog).toHaveLength(1);
  expect(smsLog[0].body).toBe("Hi Valer, sorry we missed you — I had a question about your background");
});

test("sends a no-pickup SMS on user_hangup when the user never said anything real (declined / silence)", async () => {
  const chatId = await createChat();
  const agentId = "agent_decline_x";
  await prisma.agentSettings.create({
    data: {
      userId: USER,
      agentId,
      noPickupSms: "Hi {{caller_name}}, interested in {{position}} at {{company_name}}?",
      noPickupSmsFollowup: "",
    },
  });

  await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: {
        call_id: "call_decline_1",
        agent_id: agentId,
        from_number: "+19018836036",
        to_number: "+37496200819",
        start_timestamp: 0,
        end_timestamp: 21_000,
        disconnection_reason: "user_hangup",
        transcript:
          "Agent: Hi\nUser: (inaudible speech)\nUser: (inaudible speech)\nAgent: Sorry, I didn't catch that.",
        metadata: { chatId, email: "albert@example.com" },
        retell_llm_dynamic_variables: {
          caller_name: "Albert",
          position: "Backend Engineer",
          company_name: "EPAM",
        },
      },
    });

  expect(smsLog).toHaveLength(1);
  expect(smsLog[0].body).toBe("Hi Albert, interested in Backend Engineer at EPAM?");
});

test("does NOT send a no-pickup SMS when the call connected normally", async () => {
  const chatId = await createChat();
  const agentId = "agent_nopickup_y";
  await prisma.agentSettings.create({
    data: { userId: USER, agentId, noPickupSms: "Sorry we missed you." },
  });

  await request(app)
    .post("/api/retell/webhook")
    .send({
      event: "call_ended",
      call: {
        call_id: "call_connected_1",
        agent_id: agentId,
        from_number: "+19018836036",
        to_number: "+37496200819",
        disconnection_reason: "user_hangup",
        transcript: "Agent: Hi.\nUser: Hi back.",
        metadata: { chatId },
      },
    });

  expect(smsLog).toHaveLength(0);
});

test("calls with no chat metadata are ignored (still 200)", async () => {
  const res = await request(app)
    .post("/api/retell/webhook")
    .send({ event: "call_ended", call: { call_id: "c4", disconnection_reason: "dial_failed" } });

  expect(res.status).toBe(200);
});
