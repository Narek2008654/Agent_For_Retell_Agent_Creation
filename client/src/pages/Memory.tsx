import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type Memory as MemoryItem } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Trash2Icon, BookMarked } from "lucide-react";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Memory() {
  const queryClient = useQueryClient();
  const api = useApi();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: memories = [] } = useQuery<MemoryItem[]>({
    queryKey: ["memories"],
    queryFn: api.getMemories,
  });

  async function handleDelete() {
    if (!confirmId) return;
    setDeleting(true);
    try {
      await api.deleteMemory(confirmId);
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
      toast.success("Memory deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
      setConfirmId(null);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <AppHeader navLinks={[{ to: "/", label: "Chat" }, { to: "/calls", label: "Calls" }]} />

      <main className="flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-2xl">
          <header className="mb-8">
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Memories
            </h1>
            <p className="mt-2 font-serif text-[1.05rem] leading-relaxed text-muted-foreground">
              What I've remembered about you across conversations. Remove anything
              you'd rather I forget.
            </p>
          </header>

          {memories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
              <BookMarked className="mx-auto size-7 text-muted-foreground/60" />
              <p className="mt-3 font-serif text-[1.05rem] italic text-muted-foreground">
                Nothing remembered yet.
              </p>
              <p className="mt-1 text-sm text-muted-foreground/70">
                As you chat, useful details will be collected here.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {memories.map((mem) => (
                <li
                  key={mem.id}
                  className="group flex items-start gap-4 rounded-2xl border border-border/70 bg-card px-5 py-4 shadow-sm transition-colors hover:border-primary/40"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1 h-full w-0.5 shrink-0 self-stretch rounded-full bg-primary/40"
                  />
                  <div className="flex-1">
                    <p className="font-serif text-[1.05rem] leading-relaxed text-card-foreground">
                      {mem.content}
                    </p>
                    <p className="mt-2 font-sans text-xs uppercase tracking-[0.1em] text-muted-foreground/70">
                      {formatDate(mem.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => setConfirmId(mem.id)}
                    aria-label="Delete memory"
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <Dialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete memory?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The memory will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
