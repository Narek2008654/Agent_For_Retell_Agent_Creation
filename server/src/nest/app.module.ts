import { Module } from "@nestjs/common";
import { CallsController } from "./calls.controller.js";
import { FilesController } from "./files.controller.js";
import { HealthController } from "./health.controller.js";
import { MemoryController } from "./memory.controller.js";
import { PrismaService } from "./prisma.service.js";

/**
 * Phase B in-progress: routes migrate one at a time. Routes still in
 * src/routes/* keep running via the ExpressAdapter; controllers listed
 * here own their paths fully.
 */
@Module({
  controllers: [HealthController, CallsController, MemoryController, FilesController],
  providers: [PrismaService],
})
export class AppModule {}
