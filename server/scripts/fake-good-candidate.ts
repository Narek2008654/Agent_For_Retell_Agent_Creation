// Dev harness: simulate a finished call with a strong, interested candidate and
// let the assistant decide to email them the role details — end to end, headless.
//
// It drives the REAL code paths (no HTTP / Clerk auth involved):
//   1. Seeds a chat that looks like the operator set up + placed the call.
//   2. Calls the real `handleCallEnded` webhook handler with a strong-candidate
//      transcript → summarizes, rolls up the Person, logs the Call, and posts
//      the "Your call has ended … Summary: …" notification into the chat.
//   3. Runs a real assistant turn (buildPrompt → OpenAI tool-calling → send_email
//      → Brevo → Email row) so the agent actually emails the candidate.
//
// Run:  npm run seed:fake-candidate -w server
// Env (server/.env): OPENAI_API_KEY, BREVO_API_KEY, BREVO_FROM_EMAIL (+ optional
//   BREVO_FROM_NAME). Optional overrides: RECIPIENT_EMAIL, DEV_USER_ID.
// The recipient defaults to the address you asked to test with.

import { env } from "../src/env.js";
import { prisma } from "../src/db.js";
import { createOpenAiClient, type ChatMessage, type SavedEmail } from "../src/ai/client.js";
import { createBrevoClient } from "../src/brevo/client.js";
import { createRetellClient } from "../src/retell/client.js";
import { createTwilioClient } from "../src/twilio/client.js";
import { buildPrompt } from "../src/chat/prompt.js";
import { handleCallEnded } from "../src/routes/webhook.js";

const RECIPIENT_EMAIL = (process.env["RECIPIENT_EMAIL"] ?? "stepanyann938@gmail.com").trim().toLowerCase();
const CANDIDATE_NAME = "Narek";
const POSITION = "Backend Engineer";
const COMPANY = "Acme Robotics";
const ROLE_DETAILS =
  "Own backend services in Node.js + PostgreSQL, design APIs, and scale our fleet-telemetry pipeline. Remote-friendly, senior level.";

/** A believable transcript of an interested, strong candidate. */
const TRANSCRIPT = [
  `Agent: Hi ${CANDIDATE_NAME}, this is Emma calling from ${COMPANY} about the ${POSITION} role — do you have a few minutes?`,
  "User: Yeah, absolutely, now's a good time.",
  "Agent: Great. To start — can you tell me a little about your background?",
  "User: Sure. I've been a backend engineer for about six years, mostly Node and Postgres. The last three years I led the API and data pipeline for a logistics startup.",
  "Agent: Nice, that lines up really well with what we're building. What drew you to this role specifically?",
  "User: Honestly the fleet-telemetry side — I've worked on high-throughput ingestion before and I love that problem space. And I'm looking for something more senior with ownership.",
  "Agent: That's exactly the scope here. Can you walk me through a recent project you're proud of?",
  "User: I rebuilt our event ingestion from a single Postgres table to a partitioned, queue-buffered pipeline. Cut write latency by about 70% and it handles 10x the volume now.",
  "Agent: Impressive. Where are you hoping to grow over the next couple of years?",
  "User: I'd like to move toward staff-level, owning architecture decisions and mentoring. This role sounds like a strong step toward that.",
  "Agent: Wonderful. Is there anything you'd like to know about the role or company?",
  "User: Just the specifics on the stack and next steps — but honestly I'm very interested. Could you send me the details by email?",
  "Agent: Of course, we'll follow up by email. Thanks so much for your time, Narek — you sound like a great fit.",
  "User: Thank you, looking forward to it!",
].join("\n");

/** Seed a prior operator <-> assistant conversation, returns the chat id. */
async function seedPriorChat(userId: string): Promise<string> {
  const chat = await prisma.chat.create({
    data: { userId, title: `${POSITION} — ${CANDIDATE_NAME} (demo)` },
  });

  const base = Date.now() - 10 * 60_000; // backdate so ordering is stable
  const priorTurns: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `I want to interview ${CANDIDATE_NAME} for our ${POSITION} role at ${COMPANY}. He's a referral with a strong Node/Postgres background. ${ROLE_DETAILS}`,
    },
    {
      role: "assistant",
      content: `Got it — a ${POSITION} interview at ${COMPANY}. What's ${CANDIDATE_NAME}'s email and number, and which agent should place the call?`,
    },
    {
      role: "user",
      content: `Email ${RECIPIENT_EMAIL}, use the Emma agent. Go ahead and call him.`,
    },
    {
      role: "assistant",
      content: `Starting the outbound call to ${CANDIDATE_NAME} for the ${POSITION} role at ${COMPANY}. I'll post the summary here when it ends.`,
    },
  ];

  for (let i = 0; i < priorTurns.length; i++) {
    await prisma.message.create({
      data: { ...priorTurns[i], chatId: chat.id, createdAt: new Date(base + i * 1000) },
    });
  }
  return chat.id;
}

async function main(): Promise<void> {
  const openaiKey = env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY missing — needed to summarize and run the assistant turn.");
  if (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL) {
    console.warn(
      "[warn] BREVO_API_KEY / BREVO_FROM_EMAIL not set — the assistant will report the email as not configured instead of sending.",
    );
  }

  // Resolve which signed-in user to attach the demo chat to.
  const userId =
    process.env["DEV_USER_ID"] ??
    (await prisma.chat.findFirst({ orderBy: { createdAt: "desc" }, select: { userId: true } }))?.userId;
  if (!userId) {
    throw new Error(
      "No userId found. Sign in to the app once (which creates a chat), or pass DEV_USER_ID=<clerk user id>.",
    );
  }

  const retell = createRetellClient(env.RETELL_API_KEY ?? "", { webhookUrl: env.RETELL_WEBHOOK_URL });
  const brevo = createBrevoClient(env.BREVO_API_KEY ?? "");
  const ai = createOpenAiClient(openaiKey, retell, brevo);
  const twilio = createTwilioClient(env.TWILIO_ACCOUNT_SID ?? "", env.TWILIO_AUTH_TOKEN ?? "");

  console.log(`Seeding demo chat for user ${userId} …`);
  const chatId = await seedPriorChat(userId);

  // 1) Fire the real "call_ended" webhook handler with the strong transcript.
  const now = Date.now();
  const event = {
    event: "call_ended",
    call: {
      call_id: `call_fake_${now}`,
      call_status: "ended",
      disconnection_reason: "user_hangup", // a real conversation took place → no no-pickup SMS
      from_number: env.RETELL_FROM_NUMBER ?? "+10000000000",
      to_number: "+10000000001",
      agent_id: "agent_demo",
      start_timestamp: now - 4 * 60_000,
      end_timestamp: now,
      transcript: TRANSCRIPT,
      metadata: {
        chatId,
        email: RECIPIENT_EMAIL,
        name: CANDIDATE_NAME,
        background: `Referral; ${ROLE_DETAILS}`,
      },
    },
  };
  console.log("Processing call_ended (summarize + roll-up + notify) …");
  await handleCallEnded(ai, twilio, event);

  // 2) Operator nudges the assistant to email the candidate; run a real turn.
  const nudge = `That call with ${CANDIDATE_NAME} for the ${POSITION} role at ${COMPANY} went really well — he's clearly interested and a strong fit. Please email him at ${RECIPIENT_EMAIL} with the key details for the role and the next steps.`;

  const priorMessages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  const history: ChatMessage[] = priorMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  await prisma.message.create({ data: { chatId, role: "user", content: nudge } });

  const { system, messages } = buildPrompt({ facts: [], history, message: nudge });

  const sentEmails: SavedEmail[] = [];
  console.log("Running the assistant turn (it should call send_email) …\n");
  const reply = ai.chat({
    system,
    messages,
    chatId,
    lookupPerson: async (email) => {
      const p = await prisma.person.findUnique({
        where: { userId_email: { userId, email: email.trim().toLowerCase() } },
      });
      return p ? { name: p.name, background: p.background, summary: p.summary } : null;
    },
    saveEmail: async (email) => {
      sentEmails.push(email);
      const person = await prisma.person.findUnique({
        where: { userId_email: { userId, email: email.toEmail } },
        select: { id: true },
      });
      await prisma.email.create({
        data: {
          userId,
          personId: person?.id ?? null,
          toEmail: email.toEmail,
          toName: email.toName ?? null,
          subject: email.subject,
          body: email.body,
          status: email.status,
          providerMessageId: email.providerMessageId ?? null,
          error: email.error ?? null,
        },
      });
    },
  });

  let full = "";
  for await (const chunk of reply) {
    process.stdout.write(chunk);
    full += chunk;
  }
  await prisma.message.create({ data: { chatId, role: "assistant", content: full } });

  console.log("\n\n— Done —");
  console.log(`Chat id: ${chatId} (open it in the app to see the full thread)`);
  if (sentEmails.length === 0) {
    console.log("No send_email call was made by the model this run.");
  } else {
    for (const e of sentEmails) {
      console.log(
        `send_email → ${e.toEmail}: status=${e.status}` +
          (e.providerMessageId ? `, messageId=${e.providerMessageId}` : "") +
          (e.error ? `, error=${e.error}` : "") +
          `\n  subject: ${e.subject}`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error("\n[fake-good-candidate] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
