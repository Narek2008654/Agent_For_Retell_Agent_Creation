import { Controller, Delete, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { UserId } from "./user-id.decorator.js";

@Controller("api/memory")
export class MemoryController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** List user's memories, newest first. */
  @Get()
  list(@UserId() userId: string) {
    return this.prisma.memory.findMany({
      where: { userId },
      select: { id: true, content: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Delete if owned by user, else 404. */
  @Delete(":id")
  async remove(@UserId() userId: string, @Param("id") id: string) {
    const result = await this.prisma.memory.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw new NotFoundException();
    return { ok: true };
  }
}
