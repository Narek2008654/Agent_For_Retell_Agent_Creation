import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { createFakeAi } from "../ai/fakeAi.js";
import { fakeAuth } from "../test/fakeAuth.js";

const app = createApp({ ai: createFakeAi(), requireAuth: fakeAuth });

const USER1 = "user_calls_1";
const USER2 = "user_calls_2";

async function cleanup() {
  for (const userId of [USER1, USER2]) {
    await prisma.call.deleteMany({ where: { userId } });
    await prisma.person.deleteMany({ where: { userId } });
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("GET /api/calls lists the user's calls newest first", async () => {
  const person = await prisma.person.create({
    data: { userId: USER1, email: "a@b.com", summary: "what we know" },
  });
  await prisma.call.create({
    data: {
      id: "c_old",
      userId: USER1,
      personId: person.id,
      personEmail: "a@b.com",
      durationSec: 10,
      summary: "first",
      createdAt: new Date(Date.now() - 10_000),
    },
  });
  await prisma.call.create({
    data: { id: "c_new", userId: USER1, personId: person.id, personEmail: "a@b.com", durationSec: 20, summary: "second" },
  });

  const res = await request(app).get("/api/calls").set("x-test-user-id", USER1);

  expect(res.status).toBe(200);
  expect(res.body.map((c: { id: string }) => c.id)).toEqual(["c_new", "c_old"]);
});

test("GET /api/calls/:id returns the call, person summary, and full history (newest first)", async () => {
  const res = await request(app).get("/api/calls/c_new").set("x-test-user-id", USER1);

  expect(res.status).toBe(200);
  expect(res.body.call.id).toBe("c_new");
  expect(res.body.person).toMatchObject({ email: "a@b.com", summary: "what we know" });
  expect(res.body.history.map((h: { id: string }) => h.id)).toEqual(["c_new", "c_old"]);
});

test("another user cannot see the call", async () => {
  const res = await request(app).get("/api/calls/c_new").set("x-test-user-id", USER2);
  expect(res.status).toBe(404);
});

test("a call with no person returns history of just that call", async () => {
  await prisma.call.create({ data: { id: "c_solo", userId: USER1, durationSec: 5, summary: "solo" } });

  const res = await request(app).get("/api/calls/c_solo").set("x-test-user-id", USER1);

  expect(res.body.person).toBeNull();
  expect(res.body.history.map((h: { id: string }) => h.id)).toEqual(["c_solo"]);
});
