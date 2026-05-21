import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMessages, createChat, type Message } from "@/lib/api";
import { streamChat } from "@/lib/streamChat";
import { AppHeader } from "@/components/AppHeader";
import { ChatSidebar } from "@/components/ChatSidebar";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export function Chat() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [streaming, setStreaming] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const { data: fetchedMessages = [] } = useQuery<Message[]>({
    queryKey: ["messages", selectedId],
    queryFn: () => getMessages(selectedId!),
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

  async function handleSend(text: string) {
    let chatId = selectedId;

    if (!chatId) {
      const chat = await createChat();
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      chatId = chat.id;
      setSelectedId(chatId);
    }

    // Optimistically show user message on top of persisted ones
    const baseMessages: { role: "user" | "assistant"; content: string }[] =
      fetchedMessages.map((m) => ({ role: m.role, content: m.content }));
    const withUserMessage = [...baseMessages, { role: "user" as const, content: text }];
    setOptimisticMessages(withUserMessage);

    setIsStreaming(true);
    setStreaming("");

    const activeChatId = chatId;

    await streamChat(activeChatId, text, {
      onChunk: (chunk) => {
        setStreaming((s) => s + chunk);
      },
      onDone: () => {
        setIsStreaming(false);
        setStreaming("");
        setOptimisticMessages([]);
        void queryClient.invalidateQueries({ queryKey: ["messages", activeChatId] });
        void queryClient.invalidateQueries({ queryKey: ["chats"] });
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
      <AppHeader navLink={{ to: "/memory", label: "Memory" }} />
      <div className="flex flex-1 overflow-hidden">
        <ChatSidebar
          selectedId={selectedId}
          onSelect={handleSelect}
          onDeselect={handleDeselect}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
          {selectedId ? (
            <>
              <MessageList messages={displayMessages} streaming={streaming} />
              <MessageInput onSend={handleSend} disabled={isStreaming} />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <p className="text-sm">Select or create a chat to get started.</p>
              <MessageInput onSend={handleSend} disabled={isStreaming} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
