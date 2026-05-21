import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getChats, createChat, deleteChat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatSidebarProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

export function ChatSidebar({ selectedId, onSelect, onDeselect }: ChatSidebarProps) {
  const queryClient = useQueryClient();

  const { data: chats = [] } = useQuery({
    queryKey: ["chats"],
    queryFn: getChats,
  });

  async function handleNewChat() {
    const chat = await createChat();
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
    onSelect(chat.id);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteChat(id);
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
    if (selectedId === id) {
      onDeselect();
    }
  }

  return (
    <aside className="flex w-60 flex-col border-r bg-muted/30">
      <div className="p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleNewChat}
        >
          <PlusIcon />
          New chat
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {chats.map((chat) => (
          <div
            key={chat.id}
            onClick={() => onSelect(chat.id)}
            className={cn(
              "group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted",
              selectedId === chat.id && "bg-muted font-medium",
            )}
          >
            <span className="flex-1 truncate">{chat.title || "Untitled"}</span>
            <button
              onClick={(e) => handleDelete(chat.id, e)}
              className="ml-1 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
              aria-label="Delete chat"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
