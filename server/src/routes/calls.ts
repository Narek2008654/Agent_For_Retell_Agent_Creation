import { Router } from "express";
import { prisma } from "../db.js";

// Fields each entry in an engagement history timeline carries.
const historySelect = {
  id: true,
  durationSec: true,
  status: true,
  disconnectionReason: true,
  summary: true,
  transcript: true,
  createdAt: true,
} as const;

export function createCallsRouter(): Router {
  const router = Router();

  // GET / — list the user's calls, newest first.
  router.get("/", async (req, res) => {
    const calls = await prisma.call.findMany({
      where: { userId: req.userId! },
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
    res.json(calls);
  });

  // GET /:id — one call plus, if it's attributed to a person, that person's
  // rolling summary and full call history (the engagement view).
  router.get("/:id", async (req, res) => {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!call) {
      res.status(404).json({ error: "not found" });
      return;
    }

    if (!call.personId) {
      res.json({ call, person: null, history: [call] });
      return;
    }

    const person = await prisma.person.findUnique({
      where: { id: call.personId },
      include: { calls: { orderBy: { createdAt: "desc" }, select: historySelect } },
    });

    res.json({
      call,
      person: person ? { email: person.email, summary: person.summary } : null,
      history: person ? person.calls : [call],
    });
  });

  return router;
}
