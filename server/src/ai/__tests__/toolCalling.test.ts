import { describe, it, expect } from "vitest";
import { runToolCall, normalizePlaceholders, type SavedEmail } from "../client.js";
import { createFakeBrevoClient, type SendEmailInput } from "../../brevo/client.js";
import {
  createFakeRetellClient,
  type CreateVoiceAgentInput,
  type CreatePhoneCallInput,
} from "../../retell/client.js";

// Build a synthetic OpenAI tool call (what the model would emit).
function toolCall(name: string, args: Record<string, unknown>) {
  return {
    id: "call_1",
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe("runToolCall", () => {
  it("creates a Retell voice agent and returns a confirmation", async () => {
    const calls: CreateVoiceAgentInput[] = [];
    const retell = createFakeRetellClient({ calls });

    const result = await runToolCall(
      { retell },
      toolCall("create_retell_voice_agent", {
        name: "Support",
        agent_prompt: "You are a hiring manager. Guardrails: handle silence, sensitive questions...",
        greeting: "Hi",
        voice_id: "retell-Cimo",
      }),
    );

    expect(result).toContain("Created Retell agent");
    expect(result).toContain("agent_fake");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "Support", voiceId: "retell-Cimo" });
    expect(calls[0].systemPrompt).toContain("hiring manager");
  });

  it("auto-rewrites common bad placeholders on create (job_title→position, job_description→position_details, company→company_name)", async () => {
    const made: Array<{ systemPrompt: string; greeting: string }> = [];
    const saved: Array<{ agentId: string; noPickupSms: string }> = [];
    const retell = createFakeRetellClient({
      createVoiceAgent: async (input) => {
        made.push({ systemPrompt: input.systemPrompt, greeting: input.greeting });
        return { agentId: "agent_fake", llmId: "llm_fake" };
      },
    });

    const result = await runToolCall(
      {
        retell,
        saveAgentSettings: async (agentId, settings) => {
          saved.push({ agentId, noPickupSms: settings.noPickupSms });
        },
      },
      toolCall("create_retell_voice_agent", {
        name: "Sofi",
        agent_prompt: "You're calling about the {{job_title}}. Details: {{job_description}}. From {{company}}.",
        greeting: "Hi {{caller_name}}, calling from {{company}} about the {{role}}.",
        voice_id: "retell-Cimo",
        no_pickup_sms: "Hi from {{company}} re {{job_title}}: {{job_description}}.",
      }),
    );

    expect(result).toContain("Created Retell agent");
    expect(made[0].systemPrompt).toBe(
      "You're calling about the {{position}}. Details: {{position_details}}. From {{company_name}}.",
    );
    expect(made[0].greeting).toBe("Hi {{caller_name}}, calling from {{company_name}} about the {{position}}.");
    expect(saved[0].noPickupSms).toBe("Hi from {{company_name}} re {{position}}: {{position_details}}.");
  });

  it("refuses to create when truly unknown placeholders remain, naming each one", async () => {
    const retell = createFakeRetellClient();

    const result = await runToolCall(
      { retell },
      toolCall("create_retell_voice_agent", {
        name: "X",
        agent_prompt: "Calling {{candidate_first_name}} about the {{some_made_up_thing}}.",
        greeting: "Hi",
        voice_id: "retell-Cimo",
      }),
    );

    expect(result).toMatch(/Cannot create/i);
    expect(result).toContain("{{candidate_first_name}}");
    expect(result).toContain("{{some_made_up_thing}}");
  });

  it("normalizePlaceholders leaves allowed names alone and reports unknowns", () => {
    const { text, unknown } = normalizePlaceholders(
      "Hi {{caller_name}}, role: {{job_title}}, foo: {{nope}}.",
    );
    expect(text).toBe("Hi {{caller_name}}, role: {{position}}, foo: {{nope}}.");
    expect(unknown).toEqual(["nope"]);
  });

  it("saves both no-pickup SMS templates (first + followup) at creation", async () => {
    const saved: Array<{ agentId: string; noPickupSms: string; noPickupSmsFollowup: string }> = [];
    const retell = createFakeRetellClient();

    await runToolCall(
      {
        retell,
        saveAgentSettings: async (agentId, settings) => {
          saved.push({
            agentId,
            noPickupSms: settings.noPickupSms,
            noPickupSmsFollowup: settings.noPickupSmsFollowup,
          });
        },
      },
      toolCall("create_retell_voice_agent", {
        name: "Support",
        agent_prompt: "p",
        greeting: "g",
        voice_id: "retell-Cimo",
        no_pickup_sms: "Hi {{caller_name}}, sorry we missed you about {{position}} at {{company_name}} — interested?",
        no_pickup_sms_followup: "Hi {{caller_name}}, sorry we missed you — {{call_reason}}",
      }),
    );

    expect(saved).toEqual([
      {
        agentId: "agent_fake",
        noPickupSms: "Hi {{caller_name}}, sorry we missed you about {{position}} at {{company_name}} — interested?",
        noPickupSmsFollowup: "Hi {{caller_name}}, sorry we missed you — {{call_reason}}",
      },
    ]);
  });

  it("places a call with dynamic variables and caller metadata", async () => {
    const phoneCalls: CreatePhoneCallInput[] = [];
    const retell = createFakeRetellClient({ phoneCalls });

    const result = await runToolCall(
      { retell, chatId: "chat_1" },
      toolCall("place_phone_call", {
        to_number: "+37491452889",
        agent_id: "agent_x",
        person_email: "a@b.com",
        caller_name: "Colleen",
        caller_background: "Referral candidate",
        caller_context: "Referral; backend experience.",
        position: "Backend Engineer",
        position_details: "Node/Postgres",
        company_name: "Acme Inc.",
        questions: "Explain event loops; design a rate limiter.",
        call_reason: "I had a question about your background.",
      }),
    );

    expect(result).toContain("Started outbound call to +37491452889");
    expect(phoneCalls[0]).toMatchObject({ toNumber: "+37491452889", agentId: "agent_x" });
    expect(phoneCalls[0].dynamicVariables).toMatchObject({
      position: "Backend Engineer",
      position_details: "Node/Postgres",
      caller_name: "Colleen",
      caller_context: "Referral; backend experience.",
      company_name: "Acme Inc.",
      questions: "Explain event loops; design a rate limiter.",
      call_reason: "I had a question about your background.",
    });
    expect(phoneCalls[0].metadata).toMatchObject({
      chatId: "chat_1",
      email: "a@b.com",
      name: "Colleen",
      background: "Referral candidate",
    });
  });

  it("refuses to place a call when the agent expects vars the operator didn't supply", async () => {
    const retell = createFakeRetellClient({
      requiredVariables: {
        agent_x: ["caller_name", "caller_context", "position", "position_details", "company_name"],
      },
    });

    const result = await runToolCall(
      { retell },
      toolCall("place_phone_call", {
        to_number: "+37491452889",
        agent_id: "agent_x",
        caller_name: "Albert",
        // position / position_details / company_name omitted on purpose
      }),
    );

    expect(result).toMatch(/Cannot place the call/i);
    expect(result).toContain("{{position}}");
    expect(result).toContain("{{position_details}}");
    expect(result).toContain("{{company_name}}");
  });

  it("places the call when all referenced vars are provided (caller_context can be empty)", async () => {
    const phoneCalls: CreatePhoneCallInput[] = [];
    const retell = createFakeRetellClient({
      phoneCalls,
      requiredVariables: {
        agent_x: ["caller_name", "caller_context", "position", "company_name"],
      },
    });

    const result = await runToolCall(
      { retell },
      toolCall("place_phone_call", {
        to_number: "+37491452889",
        agent_id: "agent_x",
        caller_name: "Albert",
        position: "Backend Engineer",
        company_name: "EPAM",
        // caller_context intentionally empty — first interaction
      }),
    );

    expect(result).toContain("Started outbound call");
    expect(phoneCalls).toHaveLength(1);
  });

  it("looks up a known contact", async () => {
    const result = await runToolCall(
      {
        retell: createFakeRetellClient(),
        lookupPerson: async () => ({ name: "Colleen", background: "referral", summary: "spoke twice" }),
      },
      toolCall("lookup_person", { email: "a@b.com" }),
    );

    expect(result).toContain("Colleen");
    expect(result).toContain("spoke twice");
  });

  it("reports a first interaction when the contact is unknown", async () => {
    const result = await runToolCall(
      { retell: createFakeRetellClient(), lookupPerson: async () => null },
      toolCall("lookup_person", { email: "new@b.com" }),
    );

    expect(result).toMatch(/first interaction/i);
  });

  it("ends an ongoing call and returns a confirmation", async () => {
    const stoppedCallIds: string[] = [];
    const retell = createFakeRetellClient({ stoppedCallIds });

    const result = await runToolCall({ retell }, toolCall("end_phone_call", { call_id: "call_123" }));

    expect(result).toContain("Ended call call_123");
    expect(stoppedCallIds).toEqual(["call_123"]);
  });

  it("ends the most recent ongoing call when no call_id is given", async () => {
    const stoppedCallIds: string[] = [];
    const retell = createFakeRetellClient({ stoppedCallIds });

    const result = await runToolCall({ retell }, toolCall("end_phone_call", {}));

    expect(result).toContain("most recent ongoing call");
    expect(stoppedCallIds).toEqual(["call_fake"]);
  });

  it("lists agents for the user to choose from", async () => {
    const retell = createFakeRetellClient({
      agents: [
        { agentId: "agent_1", name: "Valod" },
        { agentId: "agent_2", name: "Sales" },
      ],
    });

    const result = await runToolCall({ retell }, toolCall("list_agents", {}));

    expect(result).toContain("Valod (agent_1)");
    expect(result).toContain("Sales (agent_2)");
  });

  it("returns an 'Unknown tool' message for an unrecognized tool name", async () => {
    const result = await runToolCall({ retell: createFakeRetellClient() }, toolCall("nope", {}));
    expect(result).toMatch(/Unknown tool/);
  });

  it("returns an error message (does not throw) when the Retell call fails", async () => {
    const retell = createFakeRetellClient({
      createVoiceAgent: async () => {
        throw new Error("bad voice");
      },
    });
    const result = await runToolCall({ retell }, toolCall("create_retell_voice_agent", {}));
    expect(result).toMatch(/Error: bad voice/);
  });

  it("sends a job-details email, lowercases the recipient, and records it", async () => {
    const messages: SendEmailInput[] = [];
    const saved: SavedEmail[] = [];
    const brevo = createFakeBrevoClient({ messages });

    const result = await runToolCall(
      {
        retell: createFakeRetellClient(),
        brevo,
        saveEmail: async (e) => {
          saved.push(e);
        },
      },
      toolCall("send_email", {
        recipient_email: "Cand@Example.com",
        recipient_name: "Cand",
        position: "Backend Engineer",
        company_name: "Acme",
        key_details: "Build APIs.",
        next_steps: "Reply to confirm.",
      }),
    );

    expect(result).toContain("Sent job-details email to cand@example.com");
    expect(messages).toHaveLength(1);
    expect(messages[0].to.email).toBe("cand@example.com");
    expect(messages[0].subject).toBe("Backend Engineer opportunity at Acme");
    expect(saved[0]).toMatchObject({
      toEmail: "cand@example.com",
      status: "sent",
      subject: "Backend Engineer opportunity at Acme",
    });
  });

  it("returns an error and records a failure when sending fails", async () => {
    const saved: SavedEmail[] = [];
    const brevo = createFakeBrevoClient({
      sendEmail: async () => {
        throw new Error("brevo down");
      },
    });
    const prev = process.env.BREVO_FROM_EMAIL;
    process.env.BREVO_FROM_EMAIL = "jobs@acme.com";
    try {
      const result = await runToolCall(
        {
          retell: createFakeRetellClient(),
          brevo,
          saveEmail: async (e) => {
            saved.push(e);
          },
        },
        toolCall("send_email", { recipient_email: "x@y.com", position: "Dev", company_name: "Co" }),
      );
      expect(result).toMatch(/Error: brevo down/);
      expect(saved[0]).toMatchObject({ status: "failed", error: "brevo down" });
    } finally {
      if (prev === undefined) delete process.env.BREVO_FROM_EMAIL;
      else process.env.BREVO_FROM_EMAIL = prev;
    }
  });

  it("asks for the email when recipient_email is missing", async () => {
    const result = await runToolCall(
      { retell: createFakeRetellClient(), brevo: createFakeBrevoClient() },
      toolCall("send_email", { position: "Dev", company_name: "Co" }),
    );
    expect(result).toMatch(/no recipient_email/i);
  });
});
