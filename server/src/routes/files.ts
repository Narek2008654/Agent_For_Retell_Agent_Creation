import { Router } from "express";
import fs from "node:fs";
import { prisma } from "../db.js";

export function createFilesRouter(): Router {
  const router = Router();

  // GET /:id — stream an owned attachment file
  router.get("/:id", async (req, res) => {
    const attachment = await prisma.attachment.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });

    if (!attachment || !fs.existsSync(attachment.storedPath)) {
      res.status(404).json({ error: "not found" });
      return;
    }

    res.type(attachment.mimeType);
    fs.createReadStream(attachment.storedPath).pipe(res);
  });

  return router;
}
