import { DynamicModule, Module } from "@nestjs/common";
import { env } from "../env.js";
import { createOpenAiClient, type AiClient } from "../ai/client.js";
import { createRetellClient, type RetellClient } from "../retell/client.js";
import { createTwilioClient, type TwilioClient } from "../twilio/client.js";
import { createBrevoClient, type BrevoClient } from "../brevo/client.js";
import { CallsController } from "./calls.controller.js";
import { ChatsController } from "./chats.controller.js";
import { FilesController } from "./files.controller.js";
import { HealthController } from "./health.controller.js";
import { MemoryController } from "./memory.controller.js";
import { PRISMA_PROVIDER } from "./prisma.service.js";
import { StreamController } from "./stream.controller.js";
import { UploadsController } from "./uploads.controller.js";
import { AI_CLIENT, RETELL_CLIENT, TWILIO_CLIENT, BREVO_CLIENT } from "./tokens.js";
import { WebhookController } from "./webhook.controller.js";

/**
 * Application root. AppModule.register(opts) lets the bootstrap (and tests)
 * supply pre-built ai/retell/twilio clients instead of constructing fresh ones
 * from env vars — same pattern callers used before the Nest migration.
 */
@Module({})
export class AppModule {
  static register(
    opts: { ai?: AiClient; retell?: RetellClient; twilio?: TwilioClient; brevo?: BrevoClient } = {},
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        CallsController,
        ChatsController,
        MemoryController,
        FilesController,
        UploadsController,
        WebhookController,
        StreamController,
      ],
      providers: [
        ...PRISMA_PROVIDER,
        {
          provide: RETELL_CLIENT,
          useFactory: (): RetellClient =>
            opts.retell ??
            createRetellClient(env.RETELL_API_KEY ?? "", { webhookUrl: env.RETELL_WEBHOOK_URL }),
        },
        {
          provide: BREVO_CLIENT,
          useFactory: (): BrevoClient => opts.brevo ?? createBrevoClient(env.BREVO_API_KEY ?? ""),
        },
        {
          provide: AI_CLIENT,
          inject: [RETELL_CLIENT, BREVO_CLIENT],
          useFactory: (retell: RetellClient, brevo: BrevoClient): AiClient =>
            opts.ai ?? createOpenAiClient(env.OPENAI_API_KEY ?? "", retell, brevo),
        },
        {
          provide: TWILIO_CLIENT,
          useFactory: (): TwilioClient =>
            opts.twilio ?? createTwilioClient(env.TWILIO_ACCOUNT_SID ?? "", env.TWILIO_AUTH_TOKEN ?? ""),
        },
      ],
    };
  }
}
