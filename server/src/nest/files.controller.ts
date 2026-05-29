import fs from "node:fs";
import { Controller, Get, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "./prisma.service.js";
import { UserId } from "./user-id.decorator.js";

@Controller("api/files")
export class FilesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Stream an owned attachment file. */
  @Get(":id")
  async download(
    @UserId() userId: string,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.prisma.attachment.findFirst({ where: { id, userId } });
    if (!attachment || !fs.existsSync(attachment.storedPath)) throw new NotFoundException();
    res.type(attachment.mimeType);
    fs.createReadStream(attachment.storedPath).pipe(res);
  }
}
