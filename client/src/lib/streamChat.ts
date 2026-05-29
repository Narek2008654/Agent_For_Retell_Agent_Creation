const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface StreamHandlers {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}

export async function streamChat(
  chatId: string,
  content: string,
  token: string | null,
  attachmentIds: string[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;

  // Track whether a terminal callback has fired so we always settle the caller,
  // even on a clean EOF with no done/error frame (proxy timeout, server restart).
  let settled = false;
  const onDone = () => {
    settled = true;
    handlers.onDone();
  };
  const onError = (err: string) => {
    settled = true;
    handlers.onError(err);
  };

  try {
    res = await fetch(`${API_URL}/api/chats/${chatId}/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, attachmentIds }),
      signal,
    });
  } catch (err) {
    // Aborting (chat switch/unmount) is intentional, not a real error.
    if (err instanceof DOMException && err.name === "AbortError") return;
    onError(String(err));
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    onError(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
    return;
  }

  if (!res.body) {
    onError("empty response body");
    return;
  }

  const reader = res.body.getReader();
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
        const dataLines: string[] = [];

        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trim());
          }
        }

        const dataStr = dataLines.join("");

        if (eventType === "done") {
          onDone();
          return;
        } else if (eventType === "error") {
          try {
            const parsed = JSON.parse(dataStr) as { error: string };
            onError(parsed.error);
          } catch {
            onError(dataStr);
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

    // Flush any trailing bytes held by the TextDecoder (e.g. incomplete multi-byte sequences)
    buffer += decoder.decode();
  } catch (err) {
    // Aborting (chat switch/unmount) is intentional, not a real error.
    if (err instanceof DOMException && err.name === "AbortError") return;
    onError(String(err));
  } finally {
    reader.cancel().catch(() => {});
    // Clean EOF with no done/error frame: settle the caller so its UI doesn't
    // stay stuck streaming forever (truncated stream surfaces as an error).
    // An abort (chat switch/unmount) is intentional, so don't surface it.
    if (!settled && !signal?.aborted) onError("Stream ended unexpectedly");
  }
}
