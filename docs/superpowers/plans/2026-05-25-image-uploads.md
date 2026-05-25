# Image Uploads (Vision) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach images to a chat message; store them on disk; send them to OpenAI's vision model so the assistant can see them; render thumbnails in the thread.

**Architecture:** New `Attachment` table (disk path + metadata, owned by Clerk user id). `POST /api/uploads` (multer) saves files; `GET /api/files/:id` serves them ownership-scoped. The stream route links attachment ids to the user message and feeds image data URLs into a multimodal OpenAI call. Frontend uploads on pick, renders thumbnails via an auth'd blob fetch.

**Tech Stack:** Express + multer, Prisma/Postgres, OpenAI vision (`gpt-4o-mini`), React.

---

## Conventions
- Backend tests: `npm test -w server` (Docker Postgres up; auth via injected `fakeAuth` + `x-test-user-id`). Frontend: `npm test -w client`.
- Tests never call OpenAI (inject `createFakeAi`) and never need Clerk keys.
- Each task ends green (server tests + tsc, or client tests + tsc + build).

## File map
- **New backend:** `server/src/routes/uploads.ts`, `server/src/routes/files.ts`, `server/uploads/` (gitignored).
- **Modified backend:** `server/prisma/schema.prisma` (+migration), `server/src/ai/client.ts`, `server/src/ai/fakeAi.ts` (only if needed), `server/src/chat/prompt.ts`, `server/src/routes/stream.ts`, `server/src/routes/chats.ts` (getMessages include), `server/src/app.ts`, `server/package.json`.
- **New frontend:** `client/src/components/AuthedImage.tsx`.
- **Modified frontend:** `client/src/lib/api.ts`, `client/src/lib/useApi.ts`, `client/src/lib/streamChat.ts`, `client/src/components/MessageInput.tsx`, `client/src/components/MessageList.tsx`, `client/src/pages/Chat.tsx`.

---

## Task 1: Attachment table + migration

**Files:** `server/prisma/schema.prisma`; new migration; `.gitignore`.

- [ ] **Step 1:** Add to `schema.prisma`:
```prisma
model Attachment {
  id         String   @id @default(cuid())
  userId     String
  messageId  String?
  message    Message? @relation(fields: [messageId], references: [id], onDelete: Cascade)
  mimeType   String
  filename   String
  sizeBytes  Int
  storedPath String
  createdAt  DateTime @default(now())
}
```
Add to the `Message` model: `attachments Attachment[]`.
- [ ] **Step 2:** `cd server && npx prisma migrate dev --name add_attachments`. Confirm it applies and the pgvector `Memory` index is untouched.
- [ ] **Step 3:** Add `server/uploads/` to the root `.gitignore` (new line `uploads/` scoped, or `server/uploads/`). Create the dir with a `.gitkeep`? No — it's created at runtime; just ignore it.
- [ ] **Step 4:** `npx prisma generate`. Commit: `feat(server): Attachment model + migration`.

## Task 2: Vision support in the AI client + prompt builder

**Files:** `server/src/ai/client.ts`, `server/src/chat/prompt.ts`; tests `server/src/ai/__tests__/visionMessages.test.ts`, `server/src/chat/__tests__/prompt.test.ts`.

- [ ] **Step 1: Extend the type + extract a pure mapper.** In `client.ts`:
```ts
export interface ChatMessage { role: "user" | "assistant"; content: string; imageDataUrls?: string[] }

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** Map our messages to OpenAI chat format, expanding images into vision content parts. */
export function toOpenAiMessages(
  system: string,
  messages: ChatMessage[],
): Array<{ role: "system" | "user" | "assistant"; content: string | OpenAiContentPart[] }> {
  const out: Array<{ role: "system" | "user" | "assistant"; content: string | OpenAiContentPart[] }> = [
    { role: "system", content: system },
  ];
  for (const m of messages) {
    if (m.role === "user" && m.imageDataUrls && m.imageDataUrls.length > 0) {
      const parts: OpenAiContentPart[] = [{ type: "text", text: m.content }];
      for (const url of m.imageDataUrls) parts.push({ type: "image_url", image_url: { url } });
      out.push({ role: "user", content: parts });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
```
- [ ] **Step 2:** In `createOpenAiClient`, change `streamChat` to build messages via `toOpenAiMessages(system, messages)` (instead of inline mapping). `complete`/`embed` unchanged.
- [ ] **Step 3: Test** `visionMessages.test.ts`: a text-only message → `content` is a string; a user message with `imageDataUrls: ["data:image/png;base64,AAA"]` → `content` is an array whose first part is `{type:"text"}` and includes an `image_url` part with that url; assistant messages never get parts. Run → PASS.
- [ ] **Step 4: Prompt builder.** In `prompt.ts`, change `buildPrompt` to accept `images?: string[]` and attach them to the final user message:
```ts
export function buildPrompt(input: { facts: string[]; history: ChatMessage[]; message: string; images?: string[] }): { system: string; messages: ChatMessage[] } {
  // ...existing system assembly...
  const userMessage: ChatMessage = { role: "user", content: input.message };
  if (input.images && input.images.length > 0) userMessage.imageDataUrls = input.images;
  return { system, messages: [...input.history, userMessage] };
}
```
- [ ] **Step 5: Test** in `prompt.test.ts`: passing `images: ["data:image/png;base64,X"]` puts `imageDataUrls` on the last message; omitting it leaves `imageDataUrls` undefined. Keep existing prompt tests passing. Run → PASS.
- [ ] **Step 6:** `npx tsc --noEmit` clean. Commit: `feat(server): OpenAI vision content parts + images in prompt builder`.

## Task 3: Upload + file-serving endpoints

**Files:** `server/package.json` (+`multer`, `@types/multer`), `server/src/routes/uploads.ts`, `server/src/routes/files.ts`, `server/src/app.ts`; test `server/src/__tests__/uploads.test.ts`.

- [ ] **Step 1:** `npm install multer -w server && npm install -D @types/multer -w server`.
- [ ] **Step 2: `uploads.ts`** — factory `createUploadsRouter()`:
```ts
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db.js";

const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? path.resolve("uploads");
const MAX_BYTES = Number(process.env["MAX_UPLOAD_MB"] ?? 10) * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname)),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

export function createUploadsRouter(): Router {
  const router = Router();
  router.post("/", upload.single("file"), async (req, res) => {
    if (!req.file) { res.status(400).json({ error: "no valid image file (png/jpeg/webp/gif, <=10MB)" }); return; }
    const a = await prisma.attachment.create({
      data: {
        userId: req.userId!,
        mimeType: req.file.mimetype,
        filename: req.file.originalname,
        sizeBytes: req.file.size,
        storedPath: req.file.path,
      },
      select: { id: true, filename: true, mimeType: true },
    });
    res.json(a);
  });
  return router;
}
```
(Ensure `UPLOAD_DIR` exists at startup: `fs.mkdirSync(UPLOAD_DIR, { recursive: true })` at module load.)
- [ ] **Step 3: `files.ts`** — factory `createFilesRouter()`:
```ts
import { Router } from "express";
import fs from "node:fs";
import { prisma } from "../db.js";

export function createFilesRouter(): Router {
  const router = Router();
  router.get("/:id", async (req, res) => {
    const a = await prisma.attachment.findFirst({ where: { id: req.params.id, userId: req.userId! } });
    if (!a || !fs.existsSync(a.storedPath)) { res.status(404).json({ error: "not found" }); return; }
    res.type(a.mimeType);
    fs.createReadStream(a.storedPath).pipe(res);
  });
  return router;
}
```
- [ ] **Step 4:** Mount in `app.ts` behind the guard: `app.use("/api/uploads", guard, createUploadsRouter()); app.use("/api/files", guard, createFilesRouter());`.
- [ ] **Step 5: Test** `uploads.test.ts` (app with `requireAuth: fakeAuth`): POST a small PNG buffer via `.attach("file", buffer, { filename: "x.png", contentType: "image/png" })` with `x-test-user-id` → 200 + `{id, filename, mimeType}`; an Attachment row exists with that userId. POST a `.txt` (contentType text/plain) → file rejected → 400. `GET /api/files/:id` with the owner → 200 and the bytes; with a different `x-test-user-id` → 404. Cleanup: `prisma.attachment.deleteMany` for the test user(s) + delete created files in afterAll. Run → PASS.
- [ ] **Step 6:** `npx tsc --noEmit` clean. Commit: `feat(server): image upload + ownership-scoped file serving`.

## Task 4: Wire attachments into the chat turn + getMessages

**Files:** `server/src/routes/stream.ts`, `server/src/routes/chats.ts`; tests in `server/src/__tests__/stream.test.ts`, `chats.test.ts`.

- [ ] **Step 1: stream body.** In `stream.ts` extend the zod schema: `z.object({ content: z.string().min(1), attachmentIds: z.array(z.string()).max(5).optional() })`.
- [ ] **Step 2: link + load images** (inside the prep `try`, after inserting the user message): if `attachmentIds?.length`, fetch the user's *unlinked* attachments by id, link them, and build data URLs:
```ts
let images: string[] = [];
if (attachmentIds && attachmentIds.length > 0) {
  const atts = await prisma.attachment.findMany({
    where: { id: { in: attachmentIds }, userId: req.userId!, messageId: null },
  });
  await prisma.attachment.updateMany({
    where: { id: { in: atts.map((a) => a.id) } },
    data: { messageId: userMessage.id },
  });
  images = atts
    .filter((a) => fs.existsSync(a.storedPath))
    .map((a) => `data:${a.mimeType};base64,${fs.readFileSync(a.storedPath).toString("base64")}`);
}
```
(Capture the inserted user message: change the insert to `const userMessage = await prisma.message.create({ ... })` so you have `userMessage.id`.)
- [ ] **Step 3:** Pass `images` to `buildPrompt({ facts, history: priorHistory, message: content, images })`. Import `fs` from `node:fs`.
- [ ] **Step 4: getMessages include attachments.** In `chats.ts`, the `GET /:id/messages` query adds `attachments: { select: { id: true, filename: true, mimeType: true } }` to its `select`/`include` so each message carries its attachments.
- [ ] **Step 5: Test** (stream test, with a fake that captures input): create a chat, upload an image (insert an Attachment row directly via `prisma.attachment.create` with a real temp file, or reuse the uploads route), POST stream with `{ content: "what is this", attachmentIds: [id] }` using a fake AI whose `streamChat` captures its `input`. Assert: the attachment row now has `messageId` set to the user message; the captured `input.messages` last entry has `imageDataUrls` of length 1 starting with `data:image/png;base64,`. Also assert `GET /:id/messages` returns the user message with a non-empty `attachments` array. Cleanup includes attachments. Run → PASS.
- [ ] **Step 6:** `npx tsc --noEmit` clean. Commit: `feat(server): attach images to a chat turn (vision) + return attachments`.

## Task 5: Frontend — upload UI, thumbnails, wiring

**Files:** `client/src/lib/api.ts`, `client/src/lib/useApi.ts`, `client/src/lib/streamChat.ts`, `client/src/components/AuthedImage.tsx`, `client/src/components/MessageInput.tsx`, `client/src/components/MessageList.tsx`, `client/src/pages/Chat.tsx`; tests under `client/src/**/__tests__`.

- [ ] **Step 1: api.ts** — add an `Attachment` type `{ id: string; filename: string; mimeType: string }`, extend `Message` with `attachments?: Attachment[]`, and add:
```ts
export async function uploadFile(token: string | null, file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form, // NOTE: do not set Content-Type; the browser sets the multipart boundary
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ""}`); }
  return res.json() as Promise<Attachment>;
}
export async function getFileBlob(token: string | null, id: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/files/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}
```
- [ ] **Step 2: useApi.ts** — add `uploadFile: async (file: File) => api.uploadFile(await getToken(), file)` and `getFileBlob: async (id: string) => api.getFileBlob(await getToken(), id)`.
- [ ] **Step 3: streamChat.ts** — add `attachmentIds: string[]` param (default `[]`) and include it in the POST body: `body: JSON.stringify({ content, attachmentIds })`. Update the signature to `streamChat(chatId, content, token, attachmentIds, handlers)`.
- [ ] **Step 4: AuthedImage.tsx** (new):
```tsx
import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";

export function AuthedImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false; let objectUrl: string | null = null;
    api.getFileBlob(id).then((blob) => {
      if (revoked) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!url) return <div className={className} />;
  return <img src={url} alt={alt} className={className} />;
}
```
- [ ] **Step 5: MessageInput.tsx** — add a `MicIcon`-style paperclip button + hidden `<input type="file" accept="image/*" multiple>` and drag/drop on the container. On select: for each file (cap 5), call `api.uploadFile(file)` → collect `{id, filename}`; show pending thumbnails (an `AuthedImage` or a local `URL.createObjectURL(file)` preview) with a remove ✕. Maintain `pending: Attachment[]` state. On send: call `onSend(text, pending.map(p => p.id))` then clear pending. Update the `onSend` prop type to `(text: string, attachmentIds: string[]) => void`. Disable while streaming. Toast on upload error.
- [ ] **Step 6: Chat.tsx** — `handleSend(text, attachmentIds)` passes ids to `streamChat(activeChatId, text, await getToken(), attachmentIds, {...})`. Optimistic user bubble can ignore images (they appear after refetch) — keep it simple.
- [ ] **Step 7: MessageList.tsx** — for each message, if `attachments?.length`, render a row of `<AuthedImage id={a.id} alt={a.filename} className="max-h-48 rounded-lg" />` above/below the text.
- [ ] **Step 8: Tests:**
  - `streamChat.test.ts`: update calls to pass `[]` (or `["a1"]`) for attachmentIds; add an assertion that the POST body includes `attachmentIds`.
  - `AuthedImage.test.tsx`: mock `@clerk/clerk-react` `useAuth` + mock `@/lib/api` `getFileBlob` to resolve a `new Blob(["x"])`; stub `URL.createObjectURL`/`revokeObjectURL`; assert an `<img>` appears with the object url.
  - `MessageInput.test.tsx` (if one exists / else add): mock `useApi` so `uploadFile` resolves `{id:"a1",filename:"x.png",mimeType:"image/png"}`; simulate selecting a file; assert `uploadFile` called; then clicking send calls `onSend` with `["a1"]`.
  Run `npm test -w client` → PASS.
- [ ] **Step 9:** `cd client && npx tsc -b --noEmit` clean; `npm run build -w client` succeeds. Commit: `feat(client): image upload UI, thumbnails, attachment wiring`.

---

## Self-Review Notes
- **Spec coverage:** Attachment table (T1); vision parts + prompt images (T2); `POST /api/uploads` + `GET /api/files/:id` ownership (T3); stream `attachmentIds` link + data-URL vision + getMessages attachments (T4); upload UI + `AuthedImage` + streamChat ids (T5); limits (10MB/5 files/type whitelist) in T3/T5; multer dep (T3). All mapped.
- **Type consistency:** `ChatMessage.imageDataUrls` used in `toOpenAiMessages` (T2), `buildPrompt` (T2), and asserted in stream test (T4); `streamChat(chatId, content, token, attachmentIds, handlers)` signature consistent in T5 step 3, 6, 8 and Chat.tsx; api `Attachment {id,filename,mimeType}` matches the server `select` in T3/T4.
- **Auth for images:** `<AuthedImage>` fetches via token (no token-in-URL); `FormData` upload omits Content-Type so the multipart boundary is set by the browser (noted in T5 step 1).
- **Greenness:** T1 schema only; T2 AI/prompt + unit tests; T3 endpoints + tests; T4 wiring + tests; T5 frontend + tests — each ends green.
