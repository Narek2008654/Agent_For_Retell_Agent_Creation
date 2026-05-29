import fs from "node:fs";
import request from "supertest";
import type { Express } from "express";
import type { INestApplication } from "@nestjs/common";
import { createTestServer } from "../test/createTestServer.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";
import { fakeAuth } from "../test/fakeAuth.js";

let app: Express;
let nest: INestApplication;

const USER1 = "user_test_upload_1";
const USER2 = "user_test_upload_2";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

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
}

beforeAll(async () => {
  await cleanup();
  ({ express: app, nest } = await createTestServer({ ai: createFakeAi(), requireAuth: fakeAuth }));
});
afterAll(async () => {
  await nest.close();
  await cleanup();
  await prisma.$disconnect();
});

test("POST /api/uploads accepts a valid PNG and records an Attachment", async () => {
  const res = await request(app)
    .post("/api/uploads")
    .set("x-test-user-id", USER1)
    .attach("file", PNG, { filename: "pic.png", contentType: "image/png" });

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ filename: "pic.png", mimeType: "image/png" });
  expect(res.body.id).toBeDefined();

  const row = await prisma.attachment.findUnique({ where: { id: res.body.id } });
  expect(row?.userId).toBe(USER1);
  expect(row?.messageId).toBeNull();
});

test("POST /api/uploads rejects a non-image file with 400", async () => {
  const res = await request(app)
    .post("/api/uploads")
    .set("x-test-user-id", USER1)
    .attach("file", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });

  expect(res.status).toBe(400);
});

test("GET /api/files/:id serves the owner's file and 404s for others", async () => {
  const up = await request(app)
    .post("/api/uploads")
    .set("x-test-user-id", USER1)
    .attach("file", PNG, { filename: "pic.png", contentType: "image/png" });
  const id = up.body.id;

  const owner = await request(app).get(`/api/files/${id}`).set("x-test-user-id", USER1);
  expect(owner.status).toBe(200);
  expect(owner.headers["content-type"]).toMatch(/image\/png/);

  const other = await request(app).get(`/api/files/${id}`).set("x-test-user-id", USER2);
  expect(other.status).toBe(404);
});
