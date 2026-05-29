import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

/**
 * Phase A root module: only hosts the Nest-managed surface area. Existing
 * Express routes still live in src/app.ts and are mounted via the
 * ExpressAdapter — they will migrate into controllers in Phase B.
 */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
