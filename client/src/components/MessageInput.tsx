import { useEffect, useState, useRef, type KeyboardEvent, type DragEvent } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SendHorizonal, Paperclip, X, Mic } from "lucide-react";
import { useApi } from "@/lib/useApi";
import { useDictation } from "@/lib/useDictation";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 5;

interface PendingImage {
  id: string;
  filename: string;
  previewUrl: string;
}

interface MessageInputProps {
  onSend: (text: string, attachmentIds: string[]) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const api = useApi();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dictation = useDictation({
    onResult: (text) => setValue((v) => (v ? `${v} ${text}` : text)),
    onError: (message) => toast.error(message),
  });

  // Revoke any still-pending preview object URLs on unmount (e.g. navigating away
  // with unsent attachments) so blob URLs don't leak. Mirror `pending` into a ref
  // since the unmount cleanup runs once and needs the latest value.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  async function uploadFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const room = MAX_IMAGES - pending.length;
    if (images.length > room) toast.error(`You can attach up to ${MAX_IMAGES} images`);

    setUploading(true);
    for (const file of images.slice(0, room)) {
      const previewUrl = URL.createObjectURL(file);
      try {
        const att = await api.uploadFile(file);
        setPending((p) => [...p, { id: att.id, filename: att.filename, previewUrl }]);
      } catch (err) {
        URL.revokeObjectURL(previewUrl);
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
    }
    setUploading(false);
  }

  function removePending(id: string) {
    setPending((p) => {
      const item = p.find((x) => x.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return p.filter((x) => x.id !== id);
    });
  }

  function handleSend() {
    const text = value.trim();
    if (!text && pending.length === 0) return;
    // Allow image-only messages with a sensible default prompt for the vision model.
    const content = text || "What's in this image?";
    onSend(content, pending.map((p) => p.id));
    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPending([]);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) void uploadFiles(Array.from(e.dataTransfer.files));
  }

  const canSend = !disabled && !uploading && (value.trim().length > 0 || pending.length > 0);

  return (
    <div className="px-4 pb-5 pt-2 sm:px-6">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        className={cn(
          "mx-auto max-w-3xl rounded-[20px] border bg-card p-2 shadow-md transition-colors",
          dragging
            ? "border-primary ring-2 ring-primary/30"
            : "border-border focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15",
        )}
      >
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
            {pending.map((img) => (
              <div key={img.id} className="relative">
                <img
                  src={img.previewUrl}
                  alt={img.filename}
                  className="h-16 w-16 rounded-xl object-cover ring-1 ring-black/5"
                />
                <button
                  type="button"
                  onClick={() => removePending(img.id)}
                  aria-label={`Remove ${img.filename}`}
                  className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform hover:scale-110"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void uploadFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading || pending.length >= MAX_IMAGES}
            aria-label="Attach image"
          >
            <Paperclip />
          </Button>
          {dictation.supported && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
              disabled={disabled}
              aria-label={dictation.listening ? "Stop dictation" : "Start dictation"}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                dictation.listening && "animate-pulse text-destructive",
              )}
            >
              <Mic />
            </Button>
          )}
          <Textarea
            placeholder="Message…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="max-h-44 min-h-9 resize-none border-0 bg-transparent px-1 py-1.5 text-[0.95rem] shadow-none focus-visible:ring-0 dark:bg-transparent"
            rows={1}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send"
            className="shadow-sm transition-transform enabled:hover:scale-105"
          >
            <SendHorizonal />
          </Button>
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-3xl px-1 text-center text-xs text-muted-foreground/70">
        Press <kbd className="font-sans font-medium">Enter</kbd> to send ·{" "}
        <kbd className="font-sans font-medium">Shift</kbd>+<kbd className="font-sans font-medium">Enter</kbd> for a new line
      </p>
    </div>
  );
}
