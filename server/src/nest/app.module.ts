import { Module } from "@nestjs/common";
import { CallsController } from "./calls.controller.js";
import { HealthController } from "./health.controller.js";
import { PrismaService } from "./prisma.service.js";

/**
 * Phase B in-progress: routes migrate one at a time. Routes still in
 * src/routes/* keep running via the ExpressAdapter; controllers listed
 * here own their paths fully.
 */
@Module({
  controllers: [HealthController, CallsController],
  providers: [PrismaService],
})
export class AppModule {}
