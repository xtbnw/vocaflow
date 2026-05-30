"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getASRProvider } from "@/frontend/infrastructure/asr/asrProviderFactory";

export interface VoiceInputState {
  inputText: string;
  setInputText: (text: string) => void;
  isListening: boolean;
  voiceSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
}

export function useVoiceInput(): VoiceInputState {
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

  const committedRef = useRef("");

  const startListening = useCallback(() => {
    const asr = asrRef.current;
    if (!asr) return;
    committedRef.current = "";
    setInputText("");
    asr.start();
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    asrRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

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
    };

    asr.onError = (message) => {
      console.error("ASR error:", message);
      setIsListening(false);
    };

    return () => {
      asr.onPartialResult = null;
      asr.onFinalResult = null;
      asr.onError = null;
    };
  }, []);

  return { inputText, setInputText, isListening, voiceSupported, startListening, stopListening, toggleListening };
}
