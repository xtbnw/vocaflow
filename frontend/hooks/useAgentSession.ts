"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStreamEvent } from "@/backend/domain/agentRuntime";
import type { SessionMessage } from "@/backend/domain/sessionTypes";
import type { PendingAction } from "@/backend/app/types/pendingAction";
import {
  streamMessage,
  resumeMessage,
} from "@/frontend/api/agentClient";
import { TtsController } from "@/frontend/infrastructure/tts/ttsController";
import { createPcmPlaybackQueue } from "@/frontend/infrastructure/tts/pcmPlayer";

// ---------------------------------------------------------------------------
// SubmitSource
// ---------------------------------------------------------------------------

export type SubmitSource = "text" | "voice";

// ---------------------------------------------------------------------------
// ToolActivity — 工具调用生命周期状态
// ---------------------------------------------------------------------------

export type ToolActivity = {
  callId: string;
  tool: string;
  arguments?: unknown;
  status: "running" | "completed" | "failed";
  message?: string;
};

/** 用户可感知的日历工具集，其余视为 Deep Agents 内部工具。 */
const CALENDAR_TOOLS = new Set(["create_event", "query_events", "delete_event"]);

export function isCalendarTool(tool: string): boolean {
  return CALENDAR_TOOLS.has(tool);
}

/** 当 blocker 出现且正在录音时应停止语音识别。 */
export function shouldStopVoice(hasBlocker: boolean, isListening: boolean): boolean {
  return hasBlocker && isListening;
}

// ---------------------------------------------------------------------------
// StreamState — 纯 reducer（可独立测试）
// ---------------------------------------------------------------------------

export interface StreamState {
  threadId: string | null;
  messages: SessionMessage[];
  toolActivities: ToolActivity[];
  error: string | null;
  done: boolean;
}

export function initialStreamState(): StreamState {
  return {
    threadId: null,
    messages: [],
    toolActivities: [],
    error: null,
    done: false,
  };
}

export function reduceStreamState(
  state: StreamState,
  event: AgentStreamEvent,
): StreamState {
  switch (event.type) {
    case "thread":
      return { ...state, threadId: event.threadId };

    case "message_delta": {
      const last = state.messages[state.messages.length - 1];
      if (last && last.kind === "assistant" && last.id === event.messageId) {
        return {
          ...state,
          messages: [
            ...state.messages.slice(0, -1),
            { ...last, content: last.content + event.text },
          ],
        };
      }
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            kind: "assistant",
            id: event.messageId,
            content: event.text,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }

    case "tool_started":
      return {
        ...state,
        toolActivities: [
          ...state.toolActivities,
          {
            callId: event.callId,
            tool: event.tool,
            arguments: event.arguments,
            status: "running" as const,
          },
        ],
      };

    case "tool_finished":
      return {
        ...state,
        toolActivities: state.toolActivities.map((a) =>
          a.callId === event.callId ? { ...a, status: "completed" as const } : a,
        ),
      };

    case "tool_error":
      return {
        ...state,
        toolActivities: state.toolActivities.map((a) =>
          a.callId === event.callId
            ? { ...a, status: "failed" as const, message: event.message }
            : a,
        ),
      };

    case "interrupt":
      return state;

    case "events_changed":
      return state;

    case "done":
      return { ...state, done: true };

    case "error":
      return { ...state, error: event.message, done: true };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// buildDisplayMessages — 纯 helper：合并历史 + 乐观用户 + 本轮流消息
// ---------------------------------------------------------------------------

/**
 * 构造显示用消息列表。
 * preSubmitMessages — 本轮提交前的完整历史（包含前几轮的 user + assistant）。
 * optimisticUser — 本轮追加的乐观用户消息。
 * streamMessages — 本轮流式产出的 assistant 消息（可能仍在增量更新）。
 */
export function buildDisplayMessages(
  preSubmitMessages: SessionMessage[],
  optimisticUser: SessionMessage,
  streamMessages: SessionMessage[],
): SessionMessage[] {
  return [...preSubmitMessages, optimisticUser, ...streamMessages];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface AgentSessionState {
  threadId: string | null;
  messages: SessionMessage[];
  toolActivities: ToolActivity[];
  pendingAction: PendingAction | null;
  isSubmitting: boolean;
  isExecutingPending: boolean;
  error: string | null;
  voiceError: string | null;
  isTtsPlaying: boolean;
  submitText: (text: string, source?: SubmitSource) => Promise<void>;
  confirmPending: () => Promise<void>;
  cancelPending: () => Promise<void>;
  clearSession: () => void;
  resumeAudioContext: () => Promise<void>;
}

export function useAgentSession(
  onEventsChanged?: () => void,
): AgentSessionState {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExecutingPending, setIsExecutingPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isTtsPlaying, setIsTtsPlaying] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const ttsRef = useRef<TtsController | null>(null);

  // 同步追踪最新 messages，submitText 中需要非异步快照避免 React 批量更新竞态
  const messagesRef = useRef<SessionMessage[]>([]);
  messagesRef.current = messages;

  /** 懒加载 TtsController，同一 hook 实例复用 */
  function getTts(): TtsController {
    if (!ttsRef.current) {
      const queue = createPcmPlaybackQueue(
        undefined,
        (playing) => setIsTtsPlaying(playing),
      );
      ttsRef.current = new TtsController(
        queue,
        (msg) => setVoiceError(msg),
      );
    }
    return ttsRef.current;
  }

  // 组件卸载时终止所有进行中的流并释放 TTS
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      ttsRef.current?.dispose();
    };
  }, []);

  const submitText = useCallback(
    async (text: string, source: SubmitSource = "text") => {
      // 终止上一轮残留请求（含进行中的 resume）
      abortRef.current?.abort();
      if (source === "voice") {
        ttsRef.current?.cancel();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setIsSubmitting(true);
      setIsExecutingPending(false);
      setError(null);

      // 语音轮次：启动 TTS session
      let tts: TtsController | null = null;
      if (source === "voice") {
        setVoiceError(null);
        tts = getTts();
        // 不阻塞文字提交，仅通知 begin
        tts.start().catch(() => { /* TTS 失败不阻断文字对话 */ });
      }

      const optimisticUser: SessionMessage = {
        kind: "user",
        id: `optimistic-${Date.now()}`,
        text,
        timestamp: new Date().toISOString(),
      };

      // 从 ref 同步读取本轮提交前的完整历史，避免依赖 setMessages 回调的异步执行时序
      const preSubmit = messagesRef.current;
      setMessages([...preSubmit, optimisticUser]);

      let streamState = initialStreamState();

      try {
        await streamMessage(
          text,
          threadId,
          (event) => {
            // 已 abort，忽略旧流事件避免写回已清除的 UI
            if (controller.signal.aborted) return;

            // interrupt 事件：设置 pendingAction
            if (event.type === "interrupt") {
              setPendingAction({
                id: "",
                type: event.review.action,
                status: "pending",
                preview: event.review.preview,
                payload: event.review.arguments,
                createdAt: new Date().toISOString(),
              });
              return;
            }

            // events_changed 事件：通知外部刷新
            if (event.type === "events_changed") {
              onEventsChanged?.();
              return;
            }

            // 语音轮次：实时送入 TTS（播放状态由 PCM 队列自行管理）
            if (event.type === "message_delta" && tts) {
              tts.appendText(event.text);
            }

            streamState = reduceStreamState(streamState, event);
            setThreadId(streamState.threadId);
            setMessages(
              buildDisplayMessages(preSubmit, optimisticUser, streamState.messages),
            );
            setToolActivities(streamState.toolActivities);
            if (streamState.error) {
              setError(streamState.error);
              // Agent 错误时取消 TTS（cancel 内部 clear 队列，playing 状态由队列回调管理）
              if (tts) tts.cancel();
            }
          },
          controller.signal,
        );

        // 流正常结束（未 abort）
        if (!controller.signal.aborted) {
          if (streamState.done && !streamState.error) {
            onEventsChanged?.();
            // 语音轮次：通知 TTS 文本发送完毕
            if (tts) tts.finish();
          }
        }
      } catch (err) {
        // abort 触发的异常直接忽略，不覆盖清理后的 UI
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "请求失败";
        setError(message);
        // 异常时取消 TTS（cancel 内部 clear 队列，playing 状态由队列回调管理）
        if (tts) tts.cancel();
      } finally {
        // 仅当 controller 仍是当前请求时才清理，避免覆盖新请求状态
        if (abortRef.current === controller) {
          setIsSubmitting(false);
          abortRef.current = null;
        }
      }
    },
    [threadId, onEventsChanged],
  );

  const confirmPending = useCallback(async () => {
    if (!pendingAction || !threadId || isExecutingPending) return;

    const savedPendingAction = pendingAction;
    setIsExecutingPending(true);
    setError(null);

    const preSubmit = messagesRef.current;
    await runResume("approve", preSubmit, savedPendingAction);
  }, [pendingAction, threadId, isExecutingPending, onEventsChanged]);

  const cancelPending = useCallback(async () => {
    if (!pendingAction || !threadId || isExecutingPending) return;

    const savedPendingAction = pendingAction;
    setIsExecutingPending(true);
    setError(null);

    const preSubmit = messagesRef.current;
    await runResume("reject", preSubmit, savedPendingAction);
  }, [pendingAction, threadId, isExecutingPending, onEventsChanged]);

  /** 共享的 resume 执行逻辑：approve / reject 复用同一流程。 */
  const runResume = useCallback(
    async (decision: "approve" | "reject", preSubmit: SessionMessage[], savedPendingAction: PendingAction) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let streamState = initialStreamState();
      streamState = { ...streamState, threadId };
      let newInterruptReceived = false;

      try {
        await resumeMessage(
          threadId!,
          decision,
          (event) => {
            if (controller.signal.aborted) return;

            if (event.type === "interrupt") {
              newInterruptReceived = true;
              setPendingAction({
                id: "",
                type: event.review.action,
                status: "pending",
                preview: event.review.preview,
                payload: event.review.arguments,
                createdAt: new Date().toISOString(),
              });
              return;
            }

            if (event.type === "events_changed") {
              onEventsChanged?.();
              return;
            }

            if (event.type === "done") {
              setPendingAction(null);
            }

            streamState = reduceStreamState(streamState, event);
            setThreadId(streamState.threadId);
            setMessages([...preSubmit, ...streamState.messages]);
            setToolActivities(streamState.toolActivities);
            if (streamState.error) {
              setError(streamState.error);
            }
          },
          controller.signal,
        );

        // 日历刷新仅由 events_changed SSE 事件触发，不做无条件刷新
        // reject / error / interrupt 不触发额外刷新
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "请求失败";
        setError(message);
        if (!newInterruptReceived) {
          setPendingAction(savedPendingAction);
        }
      } finally {
        if (abortRef.current === controller) {
          setIsExecutingPending(false);
          abortRef.current = null;
        }
      }
    },
    [threadId, onEventsChanged],
  );

  const clearSession = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsSubmitting(false);
    setIsExecutingPending(false);
    messagesRef.current = [];
    ttsRef.current?.cancel();
    if (threadId) {
      void fetch(`/api/session?id=${encodeURIComponent(threadId)}`, { method: "DELETE" });
    }
    setThreadId(null);
    setMessages([]);
    setToolActivities([]);
    setPendingAction(null);
    setError(null);
    setVoiceError(null);
    setIsTtsPlaying(false);
  }, [threadId]);

  const resumeAudioContext = useCallback(async () => {
    await getTts().ensureContext();
  }, []);

  return {
    threadId,
    messages,
    toolActivities,
    pendingAction,
    isSubmitting,
    isExecutingPending,
    error,
    voiceError,
    isTtsPlaying,
    submitText,
    confirmPending,
    cancelPending,
    clearSession,
    resumeAudioContext,
  };
}
