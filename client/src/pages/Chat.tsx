import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";
import { type Message } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { streamChat } from "@/lib/streamChat";
import { AppHeader } from "@/components/AppHeader";
import { ChatSidebar } from "@/components/ChatSidebar";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export function Chat() {
  const queryClient = useQueryClient();
  const api = useApi();
  const { getToken } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [streaming, setStreaming] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const { data: fetchedMessages = [] } = useQuery<Message[]>({
    queryKey: ["messages", selectedId],
    queryFn: () => api.getMessages(selectedId!),
    enabled: !!selectedId,
  });

  function handleSelect(id: string) {
    setSelectedId(id);
    setOptimisticMessages([]);
    setStreaming("");
    setIsStreaming(false);
  }

  function handleDeselect() {
    setSelectedId(null);
    setOptimisticMessages([]);
    setStreaming("");
    setIsStreaming(false);
  }

  // Merge persisted + optimistic. While streaming, persisted messages
  // may not yet include the assistant reply, so optimistic is the source of truth.
  const displayMessages =
    optimisticMessages.length > 0 ? optimisticMessages : fetchedMessages;

  async function handleSend(text: string, attachmentIds: string[]) {
    let chatId = selectedId;

    if (!chatId) {
      const chat = await api.createChat();
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      chatId = chat.id;
      setSelectedId(chatId);
    }

    // Optimistically show user message on top of persisted ones (attached images
    // appear once the thread refetches on done).
    const baseMessages: { role: "user" | "assistant"; content: string }[] =
      fetchedMessages.map((m) => ({ role: m.role, content: m.content }));
    const withUserMessage = [...baseMessages, { role: "user" as const, content: text }];
    setOptimisticMessages(withUserMessage);

    setIsStreaming(true);
    setStreaming("");

    const activeChatId = chatId;
    const token = await getToken();

    await streamChat(activeChatId, text, token, attachmentIds, {
      onChunk: (chunk) => {
        setStreaming((s) => s + chunk);
      },
      onDone: async () => {
        await queryClient.invalidateQueries({ queryKey: ["messages", activeChatId] });
        void queryClient.invalidateQueries({ queryKey: ["chats"] });
        setOptimisticMessages([]);
        setStreaming("");
        setIsStreaming(false);
      },
      onError: (err) => {
        setIsStreaming(false);
        setStreaming("");
        toast.error(err);
      },
    });
  }

  return (
    <div className="flex h-screen flex-col">
      <AppHeader navLinks={[{ to: "/memory", label: "Memory" }, { to: "/calls", label: "Calls" }]} />
      <div className="flex flex-1 overflow-hidden">
        <ChatSidebar
          selectedId={selectedId}
          onSelect={handleSelect}
          onDeselect={handleDeselect}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          {selectedId ? (
            <MessageList
              messages={displayMessages}
              streaming={streaming}
              loading={isStreaming}
            />
          ) : (
            <Welcome onPick={(text) => handleSend(text, [])} disabled={isStreaming} />
          )}
          <MessageInput onSend={handleSend} disabled={isStreaming} />
        </main>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Explain a tricky concept simply",
  "Help me draft an email",
  "Brainstorm ideas for a project",
  "Review and improve some code",
];

function Welcome({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="animate-message-in flex max-w-lg flex-col items-center">
        <span
          aria-hidden="true"
          className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-primary font-display text-3xl font-semibold italic leading-none text-primary-foreground shadow-md"
        >
          a
        </span>
        <h1 className="text-balance font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          What can I help you with?
        </h1>
        <p className="mt-3 max-w-md text-balance font-serif text-[1.05rem] leading-relaxed text-muted-foreground">
          Start a conversation below — ask anything, share an image, or pick a
          starting point.
        </p>

        <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-card-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
