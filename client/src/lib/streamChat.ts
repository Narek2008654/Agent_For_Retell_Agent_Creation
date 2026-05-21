const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface StreamHandlers {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}

export async function streamChat(
  chatId: string,
  content: string,
  handlers: StreamHandlers,
): Promise<void> {
  let res: Response;

  try {
    res = await fetch(`${API_URL}/api/chats/${chatId}/stream`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    handlers.onError(String(err));
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    handlers.onError(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process all complete events (delimited by double newline)
      let boundaryIndex: number;
      while ((boundaryIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        if (!rawEvent.trim()) continue;

        let eventType = "";
        let dataLines: string[] = [];

        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trim());
          }
        }

        const dataStr = dataLines.join("");

        if (eventType === "done") {
          handlers.onDone();
          return;
        } else if (eventType === "error") {
          try {
            const parsed = JSON.parse(dataStr) as { error: string };
            handlers.onError(parsed.error);
          } catch {
            handlers.onError(dataStr);
          }
          return;
        } else {
          // Data chunk
          try {
            const parsed = JSON.parse(dataStr) as { text: string };
            handlers.onChunk(parsed.text);
          } catch {
            // Malformed data, skip
          }
        }
      }
    }
  } catch (err) {
    handlers.onError(String(err));
  }
}
