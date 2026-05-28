import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTwilioClient } from "../client.js";

describe("createTwilioClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs Messages.json with Basic auth and form-encoded From/To/Body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sid: "SM_real" }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const out = await createTwilioClient("AC_test", "tok_test").sendSms({
      from: "+19018836036",
      to: "+37496200819",
      body: "Hi, we missed you.",
    });

    expect(out).toEqual({ sid: "SM_real" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC_test/Messages.json");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Basic " + Buffer.from("AC_test:tok_test").toString("base64"),
    );
    const form = new URLSearchParams(init.body as string);
    expect(form.get("From")).toBe("+19018836036");
    expect(form.get("To")).toBe("+37496200819");
    expect(form.get("Body")).toBe("Hi, we missed you.");
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad auth" } as Response),
    );
    await expect(
      createTwilioClient("AC", "tok").sendSms({ from: "+1", to: "+2", body: "x" }),
    ).rejects.toThrow(/401/);
  });

  it("throws clearly when no credentials are configured", async () => {
    await expect(
      createTwilioClient("", "").sendSms({ from: "+1", to: "+2", body: "x" }),
    ).rejects.toThrow(/credentials/i);
  });
});
