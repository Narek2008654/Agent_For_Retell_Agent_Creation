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
});
