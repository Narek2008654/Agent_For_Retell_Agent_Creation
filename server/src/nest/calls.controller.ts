import { Controller, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { UserId } from "./user-id.decorator.js";

/** Fields each entry in an engagement history timeline carries. */
const HISTORY_SELECT = {
  id: true,
  durationSec: true,
  status: true,
  disconnectionReason: true,
  summary: true,
  transcript: true,
  createdAt: true,
} as const;

@Controller("api/calls")
export class CallsController {
  // Explicit @Inject — esbuild (tsx + vitest) doesn't emit decorator metadata,
  // so Nest can't infer the token from the constructor parameter type alone.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** List the user's calls, newest first. */
  @Get()
  list(@UserId() userId: string) {
    return this.prisma.call.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        personEmail: true,
        toNumber: true,
        status: true,
        durationSec: true,
        summary: true,
        createdAt: true,
      },
    });
  }

  /**
   * One call plus, if it's attributed to a person, that person's rolling
   * summary and full call history (the engagement view).
   */
  @Get(":id")
  async getOne(@UserId() userId: string, @Param("id") id: string) {
    const call = await this.prisma.call.findFirst({ where: { id, userId } });
    if (!call) throw new NotFoundException();

    if (!call.personId) return { call, person: null, history: [call] };

    const person = await this.prisma.person.findUnique({
      where: { id: call.personId },
      include: { calls: { orderBy: { createdAt: "desc" }, select: HISTORY_SELECT } },
    });

    return {
      call,
      person: person ? { email: person.email, name: person.name, summary: person.summary } : null,
      history: person ? person.calls : [call],
    };
  }
}
