const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export interface SendSmsInput {
  from: string; // E.164
  to: string;   // E.164
  body: string;
}

export interface TwilioClient {
  /** Send an SMS via Twilio Programmable Messaging. Returns Twilio's message sid. */
  sendSms(input: SendSmsInput): Promise<{ sid: string }>;
}

/** Real Twilio client backed by the Programmable Messaging REST API. */
export function createTwilioClient(accountSid: string, authToken: string): TwilioClient {
  return {
    async sendSms(input) {
      if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const form = new URLSearchParams({ From: input.from, To: input.to, Body: input.body });
      const res = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Twilio sendSms failed: ${res.status}${text ? ` ${text}` : ""}`);
      }
      const body = (await res.json()) as Record<string, unknown>;
      return { sid: String(body["sid"]) };
    },
  };
}

/** Deterministic fake for tests — records sent messages. */
export function createFakeTwilioClient(overrides?: {
  sendSms?: TwilioClient["sendSms"];
  messages?: SendSmsInput[];
}): TwilioClient {
  return {
    sendSms:
      overrides?.sendSms ??
      (async (input) => {
        overrides?.messages?.push(input);
        return { sid: "SM_fake" };
      }),
  };
}
