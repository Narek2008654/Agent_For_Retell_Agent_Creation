import { describe, it, expect } from "vitest";
import { runToolCall } from "../client.js";
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

  it("saves the no-pickup SMS template when one is provided at creation", async () => {
    const saved: Array<{ agentId: string; noPickupSms: string }> = [];
    const retell = createFakeRetellClient();

    await runToolCall(
      {
        retell,
        saveAgentSettings: async (agentId, settings) => {
          saved.push({ agentId, noPickupSms: settings.noPickupSms });
        },
      },
      toolCall("create_retell_voice_agent", {
        name: "Support",
        agent_prompt: "p",
        greeting: "g",
        voice_id: "retell-Cimo",
        no_pickup_sms: "Hi {{caller_name}}, sorry we missed you about {{position}}.",
      }),
    );

    expect(saved).toEqual([
      { agentId: "agent_fake", noPickupSms: "Hi {{caller_name}}, sorry we missed you about {{position}}." },
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
    });
    expect(phoneCalls[0].metadata).toMatchObject({
      chatId: "chat_1",
      email: "a@b.com",
      name: "Colleen",
      background: "Referral candidate",
    });
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
});
