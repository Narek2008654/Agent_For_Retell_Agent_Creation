import fs from "node:fs";
import request from "supertest";
import type { Express } from "express";
import type { INestApplication } from "@nestjs/common";
import { createTestServer } from "../test/createTestServer.js";
import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";
import { fakeAuth } from "../test/fakeAuth.js";

let app: Express;
let nest: INestApplication;

const USER1 = "user_test_stream_1";
const USER2 = "user_test_stream_2";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let chatId: string;

async function cleanup() {
  const atts = await prisma.attachment.findMany({ where: { userId: { in: [USER1, USER2] } } });
  for (const a of atts) {
    try {
      fs.unlinkSync(a.storedPath);
    } catch {
      // file may already be gone
    }
  }
  await prisma.attachment.deleteMany({ where: { userId: { in: [USER1, USER2] } } });
  await prisma.chat.deleteMany({ where: { userId: { in: [USER1, USER2] } } });
}

beforeAll(async () => {
  await cleanup();
  ({ express: app, nest } = await createTestServer({ ai: createFakeAi(), requireAuth: fakeAuth }));
  const chatRes = await request(app)
    .post("/api/chats")
    .set("x-test-user-id", USER1)
    .send({ title: "Stream Test Chat" });
  chatId = chatRes.body.id;
});

afterAll(async () => {
  await nest.close();
  await cleanup();
  await prisma.$disconnect();
});

test("POST /api/chats/:id/stream returns text/event-stream with fake AI chunks and done event", async () => {
  const res = await request(app)
    .post(`/api/chats/${chatId}/stream`)
    .set("x-test-user-id", USER1)
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
    .set("x-test-user-id", USER1)
    .send({ title: "Message Count Chat" });
  const isolatedChatId = chatRes.body.id;

  await request(app)
    .post(`/api/chats/${isolatedChatId}/stream`)
    .set("x-test-user-id", USER1)
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

test("POST /api/chats/:id/stream generates a title from the first message", async () => {
  // A dedicated app whose fake AI returns a deterministic title for `complete`.
  const { express: titledApp, nest: titledNest } = await createTestServer({
    ai: createFakeAi({ complete: async () => "Cats and Dogs" }),
    requireAuth: fakeAuth,
  });

  const chatRes = await request(titledApp)
    .post("/api/chats")
    .set("x-test-user-id", USER1)
    .send({ title: "New chat" });
  const newChatId = chatRes.body.id;

  await request(titledApp)
    .post(`/api/chats/${newChatId}/stream`)
    .set("x-test-user-id", USER1)
    .send({ content: "tell me about cats and dogs" });

  const chat = await prisma.chat.findUnique({ where: { id: newChatId } });
  expect(chat?.title).toBe("Cats and Dogs");
  await titledNest.close();
});

test("POST /api/chats/:id/stream does not change the title on later turns", async () => {
  const { express: titledApp, nest: titledNest } = await createTestServer({
    ai: createFakeAi({ complete: async () => "Generated Title" }),
    requireAuth: fakeAuth,
  });

  const chatRes = await request(titledApp)
    .post("/api/chats")
    .set("x-test-user-id", USER1)
    .send({ title: "New chat" });
  const newChatId = chatRes.body.id;

  // First turn sets the title.
  await request(titledApp)
    .post(`/api/chats/${newChatId}/stream`)
    .set("x-test-user-id", USER1)
    .send({ content: "first message" });
  const afterFirst = await prisma.chat.findUnique({ where: { id: newChatId } });
  expect(afterFirst?.title).toBe("Generated Title");

  // Second turn must NOT regenerate/overwrite it.
  await request(titledApp)
    .post(`/api/chats/${newChatId}/stream`)
    .set("x-test-user-id", USER1)
    .send({ content: "second message" });
  const afterSecond = await prisma.chat.findUnique({ where: { id: newChatId } });
  expect(afterSecond?.title).toBe("Generated Title");
  await titledNest.close();
});

test("POST /api/chats/:id/stream returns 404 when another user streams to user1's chat", async () => {
  const res = await request(app)
    .post(`/api/chats/${chatId}/stream`)
    .set("x-test-user-id", USER2)
    .send({ content: "sneaky" });

  expect(res.status).toBe(404);
  expect(res.body.message).toBe("Not Found");
});

test("POST /api/chats/:id/stream links attachments and forwards image data URLs to the AI", async () => {
  // A fake AI that records the chat input it receives.
  let captured: { system: string; messages: import("../ai/client.js").ChatMessage[] } | null = null;
  const { express: capturingApp, nest: capturingNest } = await createTestServer({
    ai: createFakeAi({
      // eslint-disable-next-line require-yield
      chat: async function* (input) {
        captured = input;
      },
    }),
    requireAuth: fakeAuth,
  });
  try {

  const chatRes = await request(capturingApp)
    .post("/api/chats")
    .set("x-test-user-id", USER1)
    .send({ title: "Vision Chat" });
  const visionChatId = chatRes.body.id;

  const up = await request(capturingApp)
    .post("/api/uploads")
    .set("x-test-user-id", USER1)
    .attach("file", PNG, { filename: "pic.png", contentType: "image/png" });
  const attachmentId = up.body.id;

  await request(capturingApp)
    .post(`/api/chats/${visionChatId}/stream`)
    .set("x-test-user-id", USER1)
    .send({ content: "what is this", attachmentIds: [attachmentId] });

  // The attachment is now linked to the user message
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  expect(att?.messageId).not.toBeNull();

  // The AI received the image as a data URL on the final user message
  expect(captured).not.toBeNull();
  const last = captured!.messages[captured!.messages.length - 1];
  expect(last.imageDataUrls).toHaveLength(1);
  expect(last.imageDataUrls![0]).toMatch(/^data:image\/png;base64,/);

  // getMessages returns the attachment on the user message
  const msgs = await request(capturingApp)
    .get(`/api/chats/${visionChatId}/messages`)
    .set("x-test-user-id", USER1);
  const userMsg = msgs.body.find((m: { role: string }) => m.role === "user");
  expect(userMsg.attachments).toHaveLength(1);
  expect(userMsg.attachments[0].id).toBe(attachmentId);
  } finally {
    await capturingNest.close();
  }
});
