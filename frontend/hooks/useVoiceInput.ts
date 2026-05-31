"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getASRProvider } from "@/frontend/infrastructure/asr/asrProviderFactory";
import {
  createVoiceAutoSubmitController,
  type VoiceAutoSubmitController,
} from "@/frontend/hooks/voiceAutoSubmitController";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseVoiceInputOptions {
  /** When provided, enables auto-submit mode: finals are accumulated and
   *  debounced; the callback is invoked when the user pauses. */
  onAutoSubmit?: (text: string) => void;
}

export interface VoiceInputState {
  inputText: string;
  setInputText: (text: string) => void;
  isListening: boolean;
  voiceSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceInput(options?: UseVoiceInputOptions): VoiceInputState {
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);

  useEffect(() => {
    const asr = getASRProvider();
    setVoiceSupported(asr.isSupported());
  }, []);

  const asrRef = useRef<ReturnType<typeof getASRProvider>>(null);
  if (!asrRef.current) {
    asrRef.current = getASRProvider();
  }

  // Ref-wrapped callback so the ASR effect (which runs once) always sees the
  // latest onAutoSubmit without needing to re-subscribe.
  const onAutoSubmitRef = useRef(options?.onAutoSubmit);
  onAutoSubmitRef.current = options?.onAutoSubmit;

  const controllerRef = useRef<VoiceAutoSubmitController | null>(null);
  const roundIdRef = useRef(0);
  const committedRef = useRef("");

  // ---------- helpers ----------

  function ensureController(): VoiceAutoSubmitController | null {
    if (!onAutoSubmitRef.current) return null;
    if (!controllerRef.current) {
      controllerRef.current = createVoiceAutoSubmitController({
        debounceMs: 800,
        onSubmit: (text) => {
          onAutoSubmitRef.current?.(text);
        },
      });
    }
    return controllerRef.current;
  }

  // ---------- public api ----------

  const startListening = useCallback(() => {
    const asr = asrRef.current;
    if (!asr) return;

    committedRef.current = "";
    setInputText("");

    const ctrl = ensureController();
    if (ctrl) {
      roundIdRef.current = ctrl.startRound();
    }

    asr.start();
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    asrRef.current?.stop();
    controllerRef.current?.stopRound();
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // ---------- ASR callbacks ----------

  useEffect(() => {
    const asr = asrRef.current;
    if (!asr) return;

    asr.onPartialResult = (text) => {
      const prefix = committedRef.current;
      setInputText(prefix ? `${prefix} ${text}` : text);
    };

    asr.onFinalResult = (text) => {
      committedRef.current = committedRef.current
        ? `${committedRef.current} ${text}`
        : text;
      setInputText(committedRef.current);

      const ctrl = controllerRef.current;
      if (ctrl) {
        ctrl.handleFinal(text, roundIdRef.current);
      }
    };

    asr.onError = (message) => {
      console.error("ASR error:", message);
      asr.stop(); // prevent WebSpeechASRProvider onend auto-restart
      controllerRef.current?.stopRound();
      setIsListening(false);
    };

    return () => {
      asr.onPartialResult = null;
      asr.onFinalResult = null;
      asr.onError = null;
    };
  }, []);

  // Dispose controller on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
    };
  }, []);

  return { inputText, setInputText, isListening, voiceSupported, startListening, stopListening, toggleListening };
}
