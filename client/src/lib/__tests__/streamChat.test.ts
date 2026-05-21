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

  it("calls onChunk for each text chunk and onDone at completion", async () => {
    const sse =
      'data: {"text":"Hello"}\n\n' +
      'data: {"text":" world"}\n\n' +
      "event: done\ndata: {}\n\n";

    vi.stubGlobal("fetch", () => makeFetchOk(makeStream([sse])));

    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await streamChat("chat-1", "hi", { onChunk, onDone, onError });

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

    await streamChat("chat-1", "hi", { onChunk, onDone, onError });

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

    await streamChat("chat-1", "hi", { onChunk, onDone, onError });

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

    await streamChat("chat-1", "hi", { onChunk, onDone, onError });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("model exploded");
    expect(onDone).not.toHaveBeenCalled();
  });
});
