import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

/**
 * Reads the authenticated userId off the Express request. The auth middleware
 * (clerkAuth in prod, fakeAuth in tests) populates req.userId before any Nest
 * controller runs. Throws 401 if it's missing.
 */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const userId = req.userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
});
