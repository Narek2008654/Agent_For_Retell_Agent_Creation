const RETELL_BASE = "https://api.retellai.com";

export interface CreateVoiceAgentInput {
  name: string;
  /** The complete, model-authored system prompt for the agent (used verbatim). */
  systemPrompt: string;
  greeting: string;
  voiceId: string;
}

export interface CreatePhoneCallInput {
  /** A Retell-registered number to call from, in E.164 format. */
  fromNumber: string;
  /** The number to call, in E.164 format. */
  toNumber: string;
  /** Optionally override which agent handles the call. */
  agentId?: string;
  /** Arbitrary data stored on the call and echoed back in webhooks (e.g. { chatId }). */
  metadata?: Record<string, unknown>;
}

export interface RetellClient {
  createVoiceAgent(input: CreateVoiceAgentInput): Promise<{ agentId: string; llmId: string }>;
  createPhoneCall(input: CreatePhoneCallInput): Promise<{ callId: string }>;
  /** Hang up an ongoing call by its id. */
  stopCall(callId: string): Promise<void>;
  /** Hang up the most recently started call that is still live; returns its id. */
  stopLatestOngoingCall(): Promise<string>;
  /** List the account's agents (latest version of each). */
  listAgents(): Promise<{ agentId: string; name: string }[]>;
}

export function createRetellClient(apiKey: string): RetellClient {
  async function send(path: string, init: RequestInit): Promise<Response> {
    if (!apiKey) throw new Error("Retell API key not configured");
    const res = await fetch(`${RETELL_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Retell ${path} failed: ${res.status}${text ? ` ${text}` : ""}`);
    }
    return res;
  }

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await send(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  async function stop(callId: string): Promise<void> {
    await send(`/v2/stop-call/${encodeURIComponent(callId)}`, { method: "POST" });
  }

  async function get(path: string): Promise<unknown> {
    const res = await send(path, { method: "GET" });
    return res.json();
  }

  return {
    async createVoiceAgent(input) {
      const llm = await post("/create-retell-llm", {
        model: "gpt-4.1",
        general_prompt: input.systemPrompt,
        begin_message: input.greeting,
        general_tools: [
          { type: "end_call", name: "end_call", description: "End the call when the conversation is complete per the system prompt." },
        ],
      });
      const llmId = String(llm["llm_id"]);

      const agent = await post("/create-agent", {
        response_engine: { type: "retell-llm", llm_id: llmId },
        voice_id: input.voiceId,
        agent_name: input.name,
        language: "en-US",
      });

      return { agentId: String(agent["agent_id"]), llmId };
    },

    async createPhoneCall(input) {
      const call = await post("/v2/create-phone-call", {
        from_number: input.fromNumber,
        to_number: input.toNumber,
        ...(input.agentId ? { override_agent_id: input.agentId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
      return { callId: String(call["call_id"]) };
    },

    async stopCall(callId) {
      await stop(callId);
    },

    async stopLatestOngoingCall() {
      const body = await post("/v3/list-calls", { sort_order: "descending", limit: 50 });
      // Calls are wrapped under `items` (fall back to a bare array defensively).
      const calls = (Array.isArray(body) ? body : body["items"] ?? []) as Array<
        Record<string, unknown>
      >;
      const live = calls.find(
        (c) => c["call_status"] === "ongoing" || c["call_status"] === "registered",
      );
      if (!live) {
        const latest = calls[0];
        if (!latest) throw new Error("No ongoing call to end.");
        const reason = latest["disconnection_reason"];
        throw new Error(
          `No ongoing call to end — the most recent call (${String(latest["call_id"])}) is ` +
            `"${String(latest["call_status"])}"${reason ? ` (${String(reason)})` : ""}.`,
        );
      }
      const callId = String(live["call_id"]);
      await stop(callId);
      return callId;
    },

    async listAgents() {
      const body = await get("/list-agents?is_latest=true");
      const agents = (Array.isArray(body) ? body : []) as Array<Record<string, unknown>>;
      return agents.map((a) => ({
        agentId: String(a["agent_id"]),
        name: a["agent_name"] ? String(a["agent_name"]) : "(unnamed)",
      }));
    },
  };
}

/** Deterministic fake for tests — records calls and returns fixed ids. */
export function createFakeRetellClient(overrides?: {
  createVoiceAgent?: RetellClient["createVoiceAgent"];
  createPhoneCall?: RetellClient["createPhoneCall"];
  stopCall?: RetellClient["stopCall"];
  stopLatestOngoingCall?: RetellClient["stopLatestOngoingCall"];
  listAgents?: RetellClient["listAgents"];
  calls?: CreateVoiceAgentInput[];
  phoneCalls?: CreatePhoneCallInput[];
  stoppedCallIds?: string[];
  agents?: { agentId: string; name: string }[];
}): RetellClient {
  return {
    createVoiceAgent:
      overrides?.createVoiceAgent ??
      (async (input) => {
        overrides?.calls?.push(input);
        return { agentId: "agent_fake", llmId: "llm_fake" };
      }),
    createPhoneCall:
      overrides?.createPhoneCall ??
      (async (input) => {
        overrides?.phoneCalls?.push(input);
        return { callId: "call_fake" };
      }),
    stopCall:
      overrides?.stopCall ??
      (async (callId) => {
        overrides?.stoppedCallIds?.push(callId);
      }),
    stopLatestOngoingCall:
      overrides?.stopLatestOngoingCall ??
      (async () => {
        overrides?.stoppedCallIds?.push("call_fake");
        return "call_fake";
      }),
    listAgents: overrides?.listAgents ?? (async () => overrides?.agents ?? []),
  };
}
