import request from "supertest";
import { createApp } from "../app.js";

test("health check returns ok", async () => {
  const res = await request(createApp()).get("/api/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
