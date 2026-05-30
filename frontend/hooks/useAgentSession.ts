"use client";

import { useCallback, useState } from "react";
import type { SessionMessage } from "@/backend/domain/sessionTypes";
import type { PendingAction } from "@/backend/app/types/pendingAction";
import {
  sendMessage,
  confirmPendingAction,
  cancelPendingAction,
} from "@/frontend/api/agentClient";

export interface AgentSessionState {
  sessionId: string | null;
  messages: SessionMessage[];
  pendingAction: PendingAction | null;
  isSubmitting: boolean;
  isExecutingPending: boolean;
  submitText: (text: string) => Promise<void>;
  confirmPending: () => Promise<void>;
  cancelPending: () => Promise<void>;
  clearSession: () => void;
}

export function useAgentSession(
  onEventsChanged?: () => void,
): AgentSessionState {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExecutingPending, setIsExecutingPending] = useState(false);

  const submitText = useCallback(
    async (text: string) => {
      setIsSubmitting(true);
      try {
        const result = await sendMessage(sessionId, text);
        setSessionId(result.sessionId);
        setMessages(result.messages);
        setPendingAction(result.pendingAction ?? null);
        if (result.eventsChanged) onEventsChanged?.();
      } finally {
        setIsSubmitting(false);
      }
    },
    [sessionId, onEventsChanged],
  );

  const confirmPending = useCallback(async () => {
    if (!pendingAction || !sessionId || isExecutingPending) return;
    setIsExecutingPending(true);
    try {
      const result = await confirmPendingAction(sessionId, pendingAction.id);
      setSessionId(result.sessionId);
      setMessages(result.messages);
      setPendingAction(result.pendingAction ?? null);
      if (result.eventsChanged) onEventsChanged?.();
    } finally {
      setIsExecutingPending(false);
    }
  }, [pendingAction, sessionId, isExecutingPending, onEventsChanged]);

  const cancelPending = useCallback(async () => {
    if (!pendingAction || !sessionId || isExecutingPending) return;
    setIsExecutingPending(true);
    try {
      const result = await cancelPendingAction(sessionId, pendingAction.id);
      setSessionId(result.sessionId);
      setMessages(result.messages);
      setPendingAction(null);
      if (result.eventsChanged) onEventsChanged?.();
    } finally {
      setIsExecutingPending(false);
    }
  }, [pendingAction, sessionId, isExecutingPending, onEventsChanged]);

  const clearSession = useCallback(async () => {
    if (sessionId) {
      void fetch(`/api/session?id=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    }
    setSessionId(null);
    setMessages([]);
    setPendingAction(null);
  }, [sessionId]);

  return {
    sessionId,
    messages,
    pendingAction,
    isSubmitting,
    isExecutingPending,
    submitText,
    confirmPending,
    cancelPending,
    clearSession,
  };
}
