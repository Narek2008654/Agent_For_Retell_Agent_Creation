import { DynamicModule, Module } from "@nestjs/common";
import { env } from "../env.js";
import { createOpenAiClient, type AiClient } from "../ai/client.js";
import { createRetellClient } from "../retell/client.js";
import { createTwilioClient, type TwilioClient } from "../twilio/client.js";
import { CallsController } from "./calls.controller.js";
import { ChatsController } from "./chats.controller.js";
import { FilesController } from "./files.controller.js";
import { HealthController } from "./health.controller.js";
import { MemoryController } from "./memory.controller.js";
import { PrismaService } from "./prisma.service.js";
import { StreamController } from "./stream.controller.js";
import { UploadsController } from "./uploads.controller.js";
import { AI_CLIENT, TWILIO_CLIENT } from "./tokens.js";
import { WebhookController } from "./webhook.controller.js";

/**
 * Phase B in-progress: routes migrate one at a time. Routes still in
 * src/routes/* keep running via the ExpressAdapter; controllers listed
 * here own their paths fully.
 *
 * AppModule.register(opts) lets the bootstrap (and tests) inject
 * pre-built ai/twilio clients instead of constructing fresh ones.
 */
@Module({})
export class AppModule {
  static register(opts: { ai?: AiClient; twilio?: TwilioClient } = {}): DynamicModule {
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
        PrismaService,
        {
          provide: AI_CLIENT,
          useFactory: (): AiClient =>
            opts.ai ??
            createOpenAiClient(
              env.OPENAI_API_KEY ?? "",
              createRetellClient(env.RETELL_API_KEY ?? "", { webhookUrl: env.RETELL_WEBHOOK_URL }),
            ),
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
