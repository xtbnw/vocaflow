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
// ASR error classification
// ---------------------------------------------------------------------------

/** Returns true for errors that should close the persistent voice session. */
export function isFatalASRError(message: string): boolean {
  const fatal = [
    "麦克风权限未授权",
    "未找到麦克风设备",
    "语音识别服务不可用",
    "当前语言不支持",
  ];
  return fatal.some((f) => message.includes(f));
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
  const sessionTokenRef = useRef(0);
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
      sessionTokenRef.current = ctrl.startSession();
    }

    asr.start();
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    asrRef.current?.stop();
    controllerRef.current?.stopSession();
    sessionTokenRef.current = 0;
    committedRef.current = "";
    setInputText("");
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
      const token = sessionTokenRef.current;
      if (ctrl && token > 0) {
        ctrl.handleFinal(text, token);
      }
    };

    asr.onError = (message) => {
      console.error("ASR error:", message);
      if (isFatalASRError(message)) {
        // Fatal errors close the persistent voice session
        asr.stop();
        controllerRef.current?.stopSession();
        sessionTokenRef.current = 0;
        committedRef.current = "";
        setInputText("");
        setIsListening(false);
      }
      // Recoverable errors (no-speech, aborted) — let the ASR provider
      // auto-restart via its onend handler; do NOT close the voice session.
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
