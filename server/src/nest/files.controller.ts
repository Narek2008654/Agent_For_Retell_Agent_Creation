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

    const stream = fs.createReadStream(attachment.storedPath);
    // A stream 'error' with no handler crashes the process (there's no global
    // exception handler for raw streams). Respond if we still can, otherwise
    // tear the response down. Also destroy the stream if the client hangs up,
    // so we don't leak the file descriptor.
    stream.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ message: "Failed to read file" });
      else res.destroy(err);
    });
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }
}
