import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamChat } from "@/lib/streamChat";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function makeFetchOk(stream: ReadableStream<Uint8Array>) {
  return Promise.resolve({
    ok: true,
    body: stream,
  } as unknown as Response);
}

describe("streamChat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onChunk for each text chunk and onDone at completion, sending the bearer token", async () => {
    const sse =
      'data: {"text":"Hello"}\n\n' +
      'data: {"text":" world"}\n\n' +
      "event: done\ndata: {}\n\n";

    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      makeFetchOk(makeStream([sse])),
    );
    vi.stubGlobal("fetch", fetchMock);

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat("chat-1", "hi", "test-token", ["a1"], { onChunk, onDone, onError });

    // Sends the Clerk session token as a bearer header
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    // Sends the attachment ids in the body
    expect(JSON.parse(init.body as string)).toEqual({ content: "hi", attachmentIds: ["a1"] });

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, "Hello");
    expect(onChunk).toHaveBeenNthCalledWith(2, " world");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("handles events split across multiple reads (chunk boundary)", async () => {
    // Split 'data: {"text":"Hello"}\n\n' across two reads
    const part1 = 'data: {"text":"He';
    const part2 = 'llo"}\n\ndata: {"text":" world"}\n\nevent: done\ndata: {}\n\n';

    vi.stubGlobal("fetch", () => makeFetchOk(makeStream([part1, part2])));

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat("chat-1", "hi", "test-token", [], { onChunk, onDone, onError });

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, "Hello");
    expect(onChunk).toHaveBeenNthCalledWith(2, " world");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError and not onChunk/onDone when response is not ok", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "boom",
      } as unknown as Response),
    );

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat("chat-1", "hi", "test-token", [], { onChunk, onDone, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls onError with error message for event:error frame and does not call onDone", async () => {
    const sse = 'event: error\ndata: {"error":"model exploded"}\n\n';

    vi.stubGlobal("fetch", () => makeFetchOk(makeStream([sse])));

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat("chat-1", "hi", "test-token", [], { onChunk, onDone, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("model exploded");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("settles via onError when the stream ends with no done/error frame (clean EOF)", async () => {
    // Chunks arrive but the connection closes without a terminal frame
    // (proxy timeout, server restart) — the caller must still be settled.
    const sse = 'data: {"text":"partial"}\n\n';

    vi.stubGlobal("fetch", () => makeFetchOk(makeStream([sse])));

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat("chat-1", "hi", "test-token", [], { onChunk, onDone, onError });

    expect(onChunk).toHaveBeenCalledWith("partial");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Stream ended unexpectedly");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("calls onError when the response has a null body", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, body: null } as unknown as Response),
    );

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat("chat-1", "hi", "test-token", [], { onChunk, onDone, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("empty response body");
    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
