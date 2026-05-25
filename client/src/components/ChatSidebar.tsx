import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/lib/useApi";
import { Button } from "@/components/ui/button";
import { PlusIcon, Trash2Icon, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatSidebarProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

export function ChatSidebar({ selectedId, onSelect, onDeselect }: ChatSidebarProps) {
  const queryClient = useQueryClient();
  const api = useApi();

  const { data: chats = [] } = useQuery({
    queryKey: ["chats"],
    queryFn: api.getChats,
  });

  // Open a blank draft instead of creating a row now — the chat is persisted on
  // the first sent message, so empty/unused conversations are never stored.
  function handleNewChat() {
    onDeselect();
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.deleteChat(id);
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
    if (selectedId === id) {
      onDeselect();
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="p-3">
        <Button
          size="default"
          className="w-full justify-start gap-2 shadow-sm"
          onClick={handleNewChat}
        >
          <PlusIcon />
          New conversation
        </Button>
      </div>

      <p className="px-4 pb-1.5 pt-1 font-sans text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
        Conversations
      </p>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {chats.length === 0 ? (
          <p className="px-2 py-3 font-serif text-sm italic text-muted-foreground">
            No conversations yet — start one above.
          </p>
        ) : (
          chats.map((chat) => {
            const active = selectedId === chat.id;
            return (
              <div
                key={chat.id}
                onClick={() => onSelect(chat.id)}
                className={cn(
                  "group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/90 hover:bg-sidebar-accent/60",
                )}
              >
                {/* Active marker rail in the accent color. */}
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                <MessageSquareText
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground/70",
                  )}
                />
                <span className="flex-1 truncate">{chat.title || "Untitled"}</span>
                <button
                  onClick={(e) => handleDelete(chat.id, e)}
                  className="ml-1 hidden rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block"
                  aria-label="Delete chat"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}
