import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db.js";

const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? path.resolve("uploads");
const MAX_BYTES = Number(process.env["MAX_UPLOAD_MB"] ?? 10) * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
});

export function createUploadsRouter(): Router {
  const router = Router();

  // POST / — upload a single image file (field name "file")
  router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "no valid image file (png/jpeg/webp/gif, <=10MB)" });
      return;
    }

    const attachment = await prisma.attachment.create({
      data: {
        userId: req.userId!,
        mimeType: req.file.mimetype,
        filename: req.file.originalname,
        sizeBytes: req.file.size,
        storedPath: req.file.path,
      },
      select: { id: true, filename: true, mimeType: true },
    });

    res.json(attachment);
  });

  return router;
}
