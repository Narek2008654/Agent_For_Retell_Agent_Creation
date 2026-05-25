import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDictation } from "@/lib/useDictation";

let lastInstance: FakeRecognition;

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());

  constructor() {
    lastInstance = this;
  }

  emitFinal(text: string) {
    const result = Object.assign([{ transcript: text }], { isFinal: true });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("useDictation", () => {
  it("starts listening, emits finalized transcripts, and stops", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const onResult = vi.fn();
    const { result } = renderHook(() => useDictation({ onResult }));

    expect(result.current.supported).toBe(true);

    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(lastInstance.start).toHaveBeenCalled();

    act(() => lastInstance.emitFinal("hello world"));
    expect(onResult).toHaveBeenCalledWith("hello world");

    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });

  it("reports unsupported when the browser lacks the Web Speech API", () => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const { result } = renderHook(() => useDictation({ onResult: vi.fn() }));
    expect(result.current.supported).toBe(false);
  });
});
