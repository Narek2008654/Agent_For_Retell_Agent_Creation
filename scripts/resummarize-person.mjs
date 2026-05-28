// Re-summarize every call for a given person.email using the new prompts in
// server/src/routes/webhook.ts, then rebuild that Person.summary from scratch
// by folding the call summaries together in chronological order.
//
// Usage: node --env-file=server/.env scripts/resummarize-person.mjs <email>

import { PrismaClient } from "@prisma/client";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/resummarize-person.mjs <email>");
  process.exit(2);
}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY missing in env");
  process.exit(2);
}
const model = process.env.CHAT_MODEL || "gpt-4o-mini";

async function complete(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

function callPrompt(transcript) {
  return (
    "Summarize this phone call so a future agent can read it and skip ground we already covered. " +
    "For every question the agent asked, write a short line capturing the caller's actual answer — " +
    "preserve specific facts, names, numbers, dates, and stated preferences. " +
    "Use a compact bulleted form, one bullet per question/topic. " +
    "If a question was asked but the caller didn't answer it, say so explicitly. " +
    "Open with a one-line outcome (interested/not / scheduled / follow-up needed).\n\n" +
    "Transcript:\n" +
    transcript
  );
}

function mergePrompt(existing, latest) {
  return (
    "Merge a contact's engagement summary with a new call summary. " +
    "Keep this as a running, growable record — do NOT compress away specific answers, facts, names, " +
    "numbers, dates, or stated preferences from either source. " +
    "Group by topic and dedupe overlapping points (latest answer wins if they conflict). " +
    "Preserve the bulleted question/answer form. " +
    "End with a short 'Open follow-ups:' section listing what's still unanswered or pending.\n\n" +
    `Existing summary:\n${existing}\n\nLatest call summary:\n${latest}`
  );
}

const prisma = new PrismaClient();
try {
  const person = await prisma.person.findFirst({ where: { email } });
  if (!person) {
    console.error("No Person row for", email);
    process.exit(1);
  }
  const calls = await prisma.call.findMany({
    where: { personEmail: email },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, disconnectionReason: true, durationSec: true, transcript: true },
  });
  console.log(`Resummarizing ${calls.length} call(s) for ${email}`);

  let rolling = "";
  for (const c of calls) {
    const transcript = (c.transcript ?? "").trim();
    const callSummary = transcript ? await complete(callPrompt(transcript)) : "No conversation took place — the call didn't connect.";
    await prisma.call.update({ where: { id: c.id }, data: { summary: callSummary } });
    rolling = rolling ? await complete(mergePrompt(rolling, callSummary)) : callSummary;
    console.log(`  ✓ ${c.id} (${c.disconnectionReason}, ${c.durationSec}s) → ${callSummary.length}c, rolling=${rolling.length}c`);
  }

  await prisma.person.update({ where: { id: person.id }, data: { summary: rolling } });
  console.log(`\nFinal Person.summary (${rolling.length}c):\n---\n${rolling}\n---`);
} finally {
  await prisma.$disconnect();
}
