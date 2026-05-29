import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://chatbot:chatbot@localhost:5432/chatbot"),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  OPENAI_API_KEY: z.string().optional(),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  RETELL_API_KEY: z.string().optional(),
  // Default Retell-registered number to place outbound calls from (E.164, e.g. +12182070114).
  RETELL_FROM_NUMBER: z.string().optional(),
  // Optional shared secret; if set, the Retell webhook must include ?secret=… matching it.
  RETELL_WEBHOOK_SECRET: z.string().optional(),
  // Public URL Retell should POST call lifecycle events to. Set on every agent at creation.
  // e.g. https://your-ngrok.ngrok-free.dev/api/retell/webhook
  RETELL_WEBHOOK_URL: z.string().optional(),
  // Twilio creds for sending the no-pickup follow-up SMS.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // Brevo transactional email.
  BREVO_API_KEY: z.string().optional(),
  BREVO_FROM_EMAIL: z.string().optional(),
  BREVO_FROM_NAME: z.string().default("Recruiting"),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default("development"),
});

export const env = envSchema.parse(process.env);
