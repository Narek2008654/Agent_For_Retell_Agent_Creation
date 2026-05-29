import { PrismaClient } from "@prisma/client";
import type { Provider } from "@nestjs/common";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { prisma } from "../db.js";

/**
 * Nest-injectable token for the database client. It is provided by
 * PRISMA_PROVIDER below, which returns the existing global singleton from
 * src/db.ts so the Nest controllers, the webhook/reconcile background work, and
 * the memory store all share ONE connection pool.
 *
 * PrismaService extends PrismaClient purely so injection sites keep their
 * `this.prisma.<model>` typing; Nest never constructs it — the provider hands
 * back the shared instance instead.
 */
export abstract class PrismaService extends PrismaClient {}

/**
 * Owns the lifecycle of the single shared pool: connect on module init,
 * disconnect on module destroy. Registered alongside PRISMA_PROVIDER so
 * Nest's shutdown hooks tear down the one pool that the rest of the app uses.
 */
@Injectable()
class PrismaLifecycle implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await prisma.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await prisma.$disconnect();
  }
}

/**
 * Resolves the PrismaService token to the db.ts singleton (cast through its
 * PrismaClient base) and registers the lifecycle owner for that same pool.
 */
export const PRISMA_PROVIDER: Provider[] = [
  { provide: PrismaService, useValue: prisma as unknown as PrismaService },
  PrismaLifecycle,
];
