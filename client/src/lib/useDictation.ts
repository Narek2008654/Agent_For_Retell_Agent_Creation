import { useEffect, useRef, useState } from "react";

// Minimal, self-contained types for the Web Speech API (not reliably present in
// lib.dom across TS versions, and `webkitSpeechRecognition` is never typed).
interface SpeechResultAlternative {
  transcript: string;
}
interface SpeechResult extends ArrayLike<SpeechResultAlternative> {
  isFinal: boolean;
}
interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseDictationOptions {
  /** Called with each finalized speech segment. */
  onResult: (text: string) => void;
  onError?: (message: string) => void;
}

/**
 * Browser speech-to-text dictation via the Web Speech API. Emits finalized
 * transcript segments through `onResult` so the caller can append them to an
 * input. `supported` is false when the browser lacks the API (degrade to typing).
 */
export function useDictation({ onResult, onError }: UseDictationOptions) {
  const ctor = getRecognitionCtor();
  const supported = ctor !== null;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Keep the latest callbacks so the recognition handlers always see fresh ones.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  });

  function start() {
    if (!ctor || recognitionRef.current) return;
    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) onResultRef.current(text);
        }
      }
    };
    recognition.onerror = (event) => {
      onErrorRef.current?.(event.error ?? "speech recognition error");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      // start() can throw synchronously (e.g. already started, not-allowed). Clear
      // the ref so the line-62 guard doesn't wedge every future start, and surface it.
      recognitionRef.current = null;
      onErrorRef.current?.(err instanceof Error ? err.message : "speech recognition error");
      return;
    }
    setListening(true);
  }

  function stop() {
    recognitionRef.current?.stop();
  }

  // Stop recognition if the component unmounts mid-listen.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, start, stop };
}
