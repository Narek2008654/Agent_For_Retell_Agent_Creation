import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBrevoClient } from "../client.js";

describe("createBrevoClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs /v3/smtp/email with the api-key header and a JSON body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "msg_real" }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const out = await createBrevoClient("key_test").sendEmail({
      from: { email: "jobs@acme.com", name: "Acme Talent" },
      to: { email: "cand@example.com", name: "Cand" },
      subject: "Backend Engineer opportunity at Acme",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(out).toEqual({ messageId: "msg_real" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("key_test");
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ email: "jobs@acme.com", name: "Acme Talent" });
    expect(body.to).toEqual([{ email: "cand@example.com", name: "Cand" }]);
    expect(body.subject).toBe("Backend Engineer opportunity at Acme");
    expect(body.htmlContent).toBe("<p>Hi</p>");
    expect(body.textContent).toBe("Hi");
  });

  it("omits the recipient name when not provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m" }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await createBrevoClient("k").sendEmail({
      from: { email: "a@b.com", name: "A" },
      to: { email: "c@d.com" },
      subject: "s",
      html: "h",
      text: "t",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual([{ email: "c@d.com" }]);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" } as Response),
    );
    await expect(
      createBrevoClient("k").sendEmail({
        from: { email: "a@b.com", name: "A" },
        to: { email: "c@d.com" },
        subject: "s",
        html: "h",
        text: "t",
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws clearly when no API key is configured", async () => {
    await expect(
      createBrevoClient("").sendEmail({
        from: { email: "a@b.com", name: "A" },
        to: { email: "c@d.com" },
        subject: "s",
        html: "h",
        text: "t",
      }),
    ).rejects.toThrow(/api key/i);
  });
});
