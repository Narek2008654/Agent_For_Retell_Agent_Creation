import { Controller, Get } from "@nestjs/common";

/**
 * Phase A proof-of-life: lives at /api/nest/health alongside the existing
 * Express /api/health route. Demonstrates Nest controllers and Express
 * coexisting on the same HTTP server. Will absorb /api/health in Phase B.
 */
@Controller("api/nest")
export class HealthController {
  @Get("health")
  health(): { ok: true; via: "nest" } {
    return { ok: true, via: "nest" };
  }
}
