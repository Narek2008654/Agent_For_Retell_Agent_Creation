import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BadRequestException, Controller, HttpCode, Inject, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { PrismaService } from "./prisma.service.js";
import { UserId } from "./user-id.decorator.js";

const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? path.resolve("uploads");
const MAX_BYTES = Number(process.env["MAX_UPLOAD_MB"] ?? 10) * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FILE_OPTIONS = {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname)),
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) =>
    cb(null, ALLOWED_MIME.has(file.mimetype)),
};

@Controller("api/uploads")
export class UploadsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Upload a single image file (field name "file"). */
  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", FILE_OPTIONS))
  async upload(@UserId() userId: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException("no valid image file (png/jpeg/webp/gif, <=10MB)");
    return this.prisma.attachment.create({
      data: {
        userId,
        mimeType: file.mimetype,
        filename: file.originalname,
        sizeBytes: file.size,
        storedPath: file.path,
      },
      select: { id: true, filename: true, mimeType: true },
    });
  }
}
