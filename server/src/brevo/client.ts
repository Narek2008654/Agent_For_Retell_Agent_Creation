const BREVO_BASE = "https://api.brevo.com/v3";

export interface SendEmailInput {
  from: { email: string; name: string };
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

export interface BrevoClient {
  /** Send a transactional email via Brevo. Returns Brevo's messageId. */
  sendEmail(input: SendEmailInput): Promise<{ messageId: string }>;
}

/** Real Brevo client backed by the v3 transactional email API. */
export function createBrevoClient(apiKey: string): BrevoClient {
  return {
    async sendEmail(input) {
      if (!apiKey) throw new Error("Brevo API key not configured");
      const res = await fetch(`${BREVO_BASE}/smtp/email`, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: input.from.email, name: input.from.name },
          to: [input.to.name ? { email: input.to.email, name: input.to.name } : { email: input.to.email }],
          subject: input.subject,
          htmlContent: input.html,
          textContent: input.text,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Brevo sendEmail failed: ${res.status}${text ? ` ${text}` : ""}`);
      }
      const body = (await res.json()) as Record<string, unknown>;
      return { messageId: String(body["messageId"]) };
    },
  };
}

/** Deterministic fake for tests — records sent emails. */
export function createFakeBrevoClient(overrides?: {
  sendEmail?: BrevoClient["sendEmail"];
  messages?: SendEmailInput[];
}): BrevoClient {
  return {
    sendEmail:
      overrides?.sendEmail ??
      (async (input) => {
        overrides?.messages?.push(input);
        return { messageId: "brevo_fake" };
      }),
  };
}
