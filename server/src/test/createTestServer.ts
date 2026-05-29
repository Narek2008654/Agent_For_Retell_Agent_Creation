import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { Logger } from "@nestjs/common";
import { createApp } from "../app.js";
import { AppModule } from "../nest/app.module.js";

/**
 * Bootstraps the same Nest-on-Express stack as src/index.ts so supertest hits
 * both Express routes and Nest controllers. Pass the same opts as createApp
 * (ai, retell, twilio, requireAuth).
 */
export async function createTestServer(opts: Parameters<typeof createApp>[0] = {}) {
  Logger.overrideLogger(false);
  const express = createApp(opts);
  const nest = await NestFactory.create(AppModule, new ExpressAdapter(express), { logger: false });
  await nest.init();
  return { express, nest };
}
