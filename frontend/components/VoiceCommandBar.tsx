"use client";

import {
  Send,
  Mic,
  MicOff,
  Volume2,
  Wrench,
  ChevronUp,
  ChevronDown,
  Trash2,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Pencil,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionMessage } from "@/backend/domain/sessionTypes";
import { useAgentSession, isCalendarTool, type ToolActivity } from "@/frontend/hooks/useAgentSession";
import { useVoiceInput } from "@/frontend/hooks/useVoiceInput";
import { useCalendarEventsRefresh } from "@/frontend/hooks/useCalendarEvents";
import { VADController } from "@/frontend/infrastructure/vad/vadController";
import { executeBargeIn, cancelCurrentReply } from "@/frontend/infrastructure/vad/bargeIn";
import { ActionPreviewPanel } from "./ActionPreviewPanel";

export function VoiceCommandBar() {
  const [collapsed, setCollapsed] = useState(true);
  const [textInputOpen, setTextInputOpen] = useState(false);
  const triggerRefresh = useCalendarEventsRefresh();

  const {
    threadId: _threadId,
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
    abortAgentStream,
    cancelTts,
  } = useAgentSession(triggerRefresh);

  // Refs for functions declared later so handleVoiceAutoSubmit can be defined
  // before them without circular imports.
  const submitRef = useRef(submitText);
  submitRef.current = submitText;
  const clearInputRef = useRef<() => void>(() => {});
  const expandRef = useRef<() => void>(() => {});
  const isListeningRef = useRef(false);

  // Ref-wrapped blocker snapshot so the auto-submit callback can read live
  // blocker state without stale closures.
  const blockerRef = useRef({ isSubmitting, pendingAction, isExecutingPending });
  blockerRef.current = { isSubmitting, pendingAction, isExecutingPending };

  const handleVoiceAutoSubmit = useCallback((text: string) => {
    const { isSubmitting: submitting, pendingAction: pending, isExecutingPending: executing } = blockerRef.current;
    if (submitting || pending || executing) {
      // Pause auto-submit during blockers but keep voice mode active.
      // The text is dropped — user can speak again after blocker resolves.
      return;
    }
    clearInputRef.current();
    expandRef.current();
    submitRef.current(text, "voice");
  }, []);

  const {
    inputText,
    setInputText,
    isListening,
    voiceSupported,
    startListening,
    toggleListening,
    stopListening,
  } = useVoiceInput({ onAutoSubmit: handleVoiceAutoSubmit });

  // Wire up late-bound refs
  isListeningRef.current = isListening;
  clearInputRef.current = () => setInputText("");
  expandRef.current = () => setCollapsed(false);

  // -- auto-barge-in toggle (localStorage, default on) --
  const [autoBargeIn, setAutoBargeIn] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("vfAutoBargeIn") !== "false";
  });

  useEffect(() => {
    localStorage.setItem("vfAutoBargeIn", String(autoBargeIn));
  }, [autoBargeIn]);

  // -- VAD controller --
  const vadRef = useRef<VADController | null>(null);
  const [vadDegraded, setVadDegraded] = useState(false);

  // -- barge-in handler (shared by VAD trigger and manual mic click) --
  const performBargeIn = useCallback(() => {
    if (!voiceSupported) return;
    if (isListeningRef.current) {
      // ASR is already on — cancel reply without restarting ASR to preserve
      // current in-progress transcription.
      cancelCurrentReply({
        cancelTts,
        abortSse: abortAgentStream,
        stopVad: () => vadRef.current?.stop(),
      });
    } else {
      // ASR is off — cancel reply and ensure ASR starts.
      executeBargeIn({
        cancelTts,
        abortSse: abortAgentStream,
        stopVad: () => vadRef.current?.stop(),
        ensureAsr: () => startListening(),
      });
    }
  }, [cancelTts, abortAgentStream, startListening, voiceSupported]);

  // -- VAD lifecycle --
  useEffect(() => {
    const shouldRun = isTtsPlaying && autoBargeIn && !vadDegraded && voiceSupported;

    if (shouldRun && !vadRef.current?.isRunning) {
      const vad = new VADController(
        () => performBargeIn(),
        (_msg) => setVadDegraded(true),
      );
      vadRef.current = vad;
      vad.start();
    }

    if (!shouldRun && vadRef.current?.isRunning) {
      vadRef.current.stop();
    }
  }, [isTtsPlaying, autoBargeIn, vadDegraded, voiceSupported, performBargeIn]);

  // Dispose VAD on unmount
  useEffect(() => {
    return () => {
      vadRef.current?.dispose();
      vadRef.current = null;
    };
  }, []);

  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, toolActivities]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = inputText.trim();
    if (!text || isSubmitting || pendingAction || isExecutingPending) return;

    setInputText("");
    setCollapsed(false);
    setTextInputOpen(false);
    await submitText(text);
  };

  const handleClearSession = () => {
    stopListening();
    clearSession();
    setCollapsed(true);
  };

  const handleMicClick = async () => {
    const blocked = !!pendingAction || isExecutingPending;

    // TTS playing — barge in (mic click always interrupts)
    if (isTtsPlaying) {
      performBargeIn();
      return;
    }

    // Resume AudioContext in user gesture
    if (voiceSupported) {
      try { await resumeAudioContext(); } catch {}
    }

    // If voice mode is on, turn it off (explicit user action)
    if (isListening) {
      stopListening();
      return;
    }

    // If voice mode is off, turn it on (unless blocked by pending action)
    if (blocked) return;
    startListening();
  };

  const hasBlocker = !!pendingAction || isExecutingPending;
  const hasMessages = messages.length > 0;
  const hasToolActivities = toolActivities.length > 0;
  const latestMessage = hasMessages ? messages[messages.length - 1] : null;
  const hasActiveTools = toolActivities.some((a) => a.status === "running");

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pb-4">
      {/* Message list — expandable above the voice bar */}
      {hasMessages && !collapsed && (
        <div
          className={`pointer-events-auto mb-2 flex w-full flex-col ${
            pendingAction ? "max-w-[1100px]" : "max-w-[760px]"
          }`}
        >
          <div className={`flex gap-4 ${pendingAction ? "flex-row" : "flex-col"}`}>
            <div className="min-w-0 flex-1">
              <div
                className="vf-glass max-h-[40vh] overflow-y-auto rounded-2xl border border-white/30 p-3 shadow-sm"
                ref={messageListRef}
              >
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}

                {hasToolActivities && (
                  <div className="mt-2 border-t border-[#625f50]/10 pt-2">
                    <ToolActivityList activities={toolActivities} />
                  </div>
                )}

                {error && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#ffdad6]/60 px-4 py-2.5 text-sm text-[#ba1a1a]">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {!error && voiceError && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#fff9e6]/80 px-4 py-2.5 text-xs text-[#625f50]">
                    <Volume2 className="h-3.5 w-3.5 shrink-0" />
                    <span>{voiceError}</span>
                  </div>
                )}
              </div>
            </div>

            {pendingAction && (
              <div className="w-[320px] shrink-0">
                <ActionPreviewPanel
                  pendingAction={pendingAction}
                  onConfirm={confirmPending}
                  onCancel={cancelPending}
                  disabled={isExecutingPending}
                />
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between rounded-xl bg-[#f6f3f2]/90 px-4 py-2 text-xs text-[#49473f] backdrop-blur-sm">
            <button
              className="flex items-center gap-1 rounded-full px-3 py-1 transition-colors hover:bg-[#e5e2e1]/50"
              onClick={() => setCollapsed(true)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
              收起
            </button>
            <button
              className="flex items-center gap-1 rounded-full px-3 py-1 text-[#ba1a1a] transition-colors hover:bg-[#ffdad6]/50"
              onClick={handleClearSession}
            >
              <Trash2 className="h-3.5 w-3.5" />
              清除
            </button>
          </div>
        </div>
      )}

      {hasMessages && collapsed && (
        <div className="pointer-events-auto mb-2 flex w-full max-w-[760px] flex-col">
          <div className="vf-glass rounded-2xl border border-white/30 p-3 shadow-sm">
            <MessageBubble message={latestMessage!} />
            {hasActiveTools && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#e8e2d0]/40 px-3 py-1.5 text-xs text-[#625f50]">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>正在处理...</span>
              </div>
            )}
          </div>

          {pendingAction && (
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#fff9e6]/90 px-4 py-2 text-xs text-[#625f50] backdrop-blur-sm">
              <Clock className="h-3.5 w-3.5" />
              <span>
                有待确认的{pendingAction.type === "create_event" ? "创建" : "删除"}操作
              </span>
              <button
                className="ml-auto rounded-full bg-[#e8f5e9] px-3 py-1 text-xs font-medium text-[#2e7d32] transition-colors hover:bg-[#c8e6c9]"
                onClick={() => setCollapsed(false)}
              >
                查看
              </button>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between rounded-xl bg-[#f6f3f2]/90 px-4 py-2 text-xs text-[#49473f] backdrop-blur-sm">
            <button
              className="flex items-center gap-1 rounded-full px-3 py-1 transition-colors hover:bg-[#e5e2e1]/50"
              onClick={() => setCollapsed(false)}
            >
              <ChevronUp className="h-3.5 w-3.5" />
              展开
            </button>
            <button
              className="flex items-center gap-1 rounded-full px-3 py-1 text-[#ba1a1a] transition-colors hover:bg-[#ffdad6]/50"
              onClick={handleClearSession}
            >
              <Trash2 className="h-3.5 w-3.5" />
              清除
            </button>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* Voice Bar Capsule — prototype-inspired design                    */}
      {/* ================================================================ */}
      <div className="pointer-events-auto flex w-full max-w-[760px] justify-center">
        {/* Main voice capsule */}
        <div
          className={`vf-glass vf-voice-bar ambient-glow flex h-16 items-center rounded-full p-1 overflow-hidden ${
            isListening ? "expanded" : ""
          }`}
        >
          {/* Mic button */}
          <button
            className={`shrink-0 w-14 h-14 rounded-full flex items-center justify-center shadow-sm border border-white/50 transition-all duration-300 hover:scale-105 z-10 ${
              !voiceSupported
                ? "bg-[#e5e2e1] cursor-not-allowed text-[#49473f]/30"
                : hasBlocker
                  ? "bg-[#fff9e6] cursor-not-allowed text-[#625f50]/40"
                  : isListening
                    ? "bg-[#ffdad6] text-[#93000a]"
                    : "bg-[#fff9e6] text-[#625f50] pulse-ring"
            }`}
            disabled={!voiceSupported || hasBlocker}
            onClick={hasBlocker ? undefined : handleMicClick}
            aria-label={
              !voiceSupported
                ? "浏览器不支持语音识别"
                : hasBlocker
                  ? "请先确认当前操作"
                  : isTtsPlaying
                    ? "打断播报"
                    : isListening
                      ? "关闭语音模式"
                      : "开启语音模式"
            }
            title={
              !voiceSupported
                ? "浏览器不支持语音识别"
                : hasBlocker
                  ? "请先确认当前操作"
                  : isTtsPlaying
                    ? "打断播报"
                    : isListening
                      ? "关闭语音模式"
                      : "开启语音模式"
            }
          >
            {isTtsPlaying ? (
              <Volume2 className="h-6 w-6 text-[#2e7d32]" />
            ) : voiceSupported ? (
              <Mic className="h-6 w-6" />
            ) : (
              <MicOff className="h-6 w-6" />
            )}
          </button>

          {/* Expanded content: waveform + transcription + close */}
          {isListening && (
            <div className="flex-1 flex items-center justify-between pl-4 h-full min-w-0">
              {/* Animated waveform bars */}
              <div className="flex items-end gap-1 h-6 w-12 shrink-0">
                <div className="w-1 bg-[#625f50] rounded-full wave-bar h-full" />
                <div className="w-1 bg-[#625f50] rounded-full wave-bar h-2/3" />
                <div className="w-1 bg-[#625f50] rounded-full wave-bar h-full" />
                <div className="w-1 bg-[#625f50] rounded-full wave-bar h-1/2" />
                <div className="w-1 bg-[#625f50] rounded-full wave-bar h-4/5" />
                <div className="w-1 bg-[#625f50] rounded-full wave-bar h-1/3" />
              </div>

              {/* Scrolling transcription or placeholder */}
              <div className="flex-1 overflow-hidden transcription-scroll ml-3 h-full flex items-center relative min-w-0">
                <div className="absolute inset-0 flex items-center">
                  {inputText ? (
                    <span className="text-sm text-[#1c1b1b] whitespace-nowrap animate-scroll">
                      {inputText}
                    </span>
                  ) : (
                    <span className="text-sm text-[#49473f]/40 whitespace-nowrap">
                      正在聆听...
                    </span>
                  )}
                </div>
              </div>

              {/* Close button */}
              <button
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#e5e2e1]/50 transition-colors text-[#5f5f58] ml-1"
                onClick={(e) => { e.stopPropagation(); stopListening(); }}
                aria-label="关闭语音模式"
                title="关闭语音模式"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Secondary controls stay out of the primary voice path. */}
      <div className="pointer-events-auto fixed bottom-24 right-4 flex max-w-[calc(100vw-2rem)] items-center justify-end gap-2">
        {/* Auto-barge-in toggle */}
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-xs text-[#49473f]/70">
          <span>自动打断</span>
          <button
            role="switch"
            aria-checked={autoBargeIn}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              autoBargeIn ? "bg-[#2e7d32]/70" : "bg-[#49473f]/20"
            }`}
            onClick={() => setAutoBargeIn(!autoBargeIn)}
            title={
              vadDegraded
                ? "麦克风权限未授权，仅支持手动打断"
                : autoBargeIn
                  ? "播报时开口自动打断（已开启）"
                  : "播报时需点击麦克风打断"
            }
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                autoBargeIn ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </button>
          {vadDegraded && (
            <span className="hidden text-[#ba1a1a]/70 lg:inline">（仅手动模式）</span>
          )}
        </label>

        {/* Text input — secondary, only visible when user clicks pencil */}
        {textInputOpen ? (
          <form
            className="vf-glass flex h-12 w-[min(400px,calc(100vw-9rem))] items-center rounded-full border border-white/30 px-4 shadow-sm transition-colors focus-within:border-[#625f50]/50"
            onSubmit={handleSubmit}
          >
            <input
              className="min-w-0 flex-1 border-none bg-transparent p-0 text-sm text-[#1c1b1b] outline-none placeholder:text-[#49473f]/50 focus:ring-0"
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isSubmitting ? "处理中..." : hasBlocker ? "请先确认当前操作" : "输入指令..."}
              type="text"
              value={inputText}
              disabled={isSubmitting || hasBlocker}
              autoFocus
            />
            <button
              className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff9e6] text-[#625f50] transition-colors hover:bg-[#e8e2d0] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!inputText.trim() || isSubmitting || hasBlocker}
              type="submit"
              aria-label="发送文字指令"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
            <button
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#49473f]/50 transition-colors hover:bg-[#e5e2e1]/30"
              onClick={() => { setTextInputOpen(false); setInputText(""); }}
              type="button"
              aria-label="关闭文字输入"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            className="vf-glass flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/30 text-[#625f50]/60 transition-colors hover:bg-[#fff9e6]/50 hover:text-[#625f50]"
            onClick={() => setTextInputOpen(true)}
            disabled={hasBlocker}
            aria-label="打开文字输入"
            title="文字输入"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolActivityList — 工具调用状态列表
// ---------------------------------------------------------------------------

function ToolActivityList({ activities }: { activities: ToolActivity[] }) {
  const [expandedInternal, setExpandedInternal] = useState(false);

  const calendar = activities.filter((a) => isCalendarTool(a.tool));
  const internal = activities.filter((a) => !isCalendarTool(a.tool));

  const internalRunning = internal.filter((a) => a.status === "running").length;
  const internalCompleted = internal.filter((a) => a.status === "completed").length;
  const internalFailed = internal.filter((a) => a.status === "failed").length;

  const statParts: string[] = [];
  if (internalRunning > 0) statParts.push(`${internalRunning} 个运行中`);
  if (internalCompleted > 0) statParts.push(`${internalCompleted} 个已完成`);
  if (internalFailed > 0) statParts.push(`${internalFailed} 个失败`);

  return (
    <div className="space-y-1.5">
      {calendar.map((a) => (
        <CalendarToolCard key={a.callId} activity={a} />
      ))}

      {internal.length > 0 && (
        <div className="rounded-lg bg-[#e8e2d0]/40 px-3 py-1.5">
          <button
            className="flex w-full items-center gap-1.5 text-xs text-[#625f50]"
            onClick={() => setExpandedInternal(!expandedInternal)}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${expandedInternal ? "rotate-90" : ""}`}
            />
            <Wrench className="h-3 w-3" />
            <span>
              {internalRunning > 0 && (
                <span className="mr-1 inline-flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                </span>
              )}
              {statParts.join("，")}
            </span>
          </button>

          {expandedInternal && (
            <div className="mt-1.5 space-y-1">
              {internal.map((a) => (
                <div key={a.callId} className="flex items-center gap-1.5 pl-4 text-[11px] text-[#49473f]/70">
                  <StatusIcon status={a.status} />
                  <span className="font-medium">{a.tool}</span>
                  {a.status === "running" && (
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-[#625f50]" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalendarToolCard — 日历工具详细卡片
// ---------------------------------------------------------------------------

function CalendarToolCard({ activity }: { activity: ToolActivity }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-white/50 px-3 py-2">
      <StatusIcon status={activity.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[#1c1b1b]">
            {toolLabel(activity.tool)}
          </span>
          {activity.status === "running" && (
            <Loader2 className="h-3 w-3 animate-spin text-[#625f50]" />
          )}
        </div>
        {activity.arguments != null && (
          <div className="mt-0.5 text-[11px] text-[#49473f]/60 truncate">
            {formatArgsSummary(activity.arguments as Record<string, unknown>)}
          </div>
        )}
        {activity.status === "failed" && activity.message && (
          <div className="mt-0.5 text-[11px] text-[#ba1a1a]">{activity.message}</div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ToolActivity["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#625f50]" />;
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#2e7d32]" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 shrink-0 text-[#ba1a1a]" />;
  }
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: SessionMessage }) {
  switch (message.kind) {
    case "user":
      return (
        <div className="mb-2 flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[#fff9e6] px-4 py-2.5 text-sm text-[#1c1b1b] shadow-sm">
            {message.text}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="mb-2 flex justify-start">
          <div
            className={`max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm shadow-sm ${
              message.toolCall
                ? "bg-[#e8e2d0]/60 text-[#1c1b1b]"
                : "bg-[#f6f3f2] text-[#1c1b1b]"
            }`}
          >
            {message.toolCall && (
              <div className="mb-1 flex items-center gap-1.5">
                <Wrench className="h-3 w-3 text-[#625f50]" />
                <span className="text-[10px] font-medium uppercase tracking-widest text-[#49473f]/60">
                  工具调用
                </span>
              </div>
            )}
            <p>{message.content}</p>
            {message.toolCall && (
              <div className="mt-2 rounded-lg bg-white/50 px-3 py-1.5 text-[11px] text-[#625f50]">
                <span className="font-medium">{toolLabel(message.toolCall.tool)}</span>
                <span className="ml-2 text-[#49473f]/60">
                  {formatArgsSummary(message.toolCall.arguments)}
                </span>
              </div>
            )}
          </div>
        </div>
      );

  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toolLabel(tool: string): string {
  switch (tool) {
    case "create_event":
      return "创建日程";
    case "query_events":
      return "查询日程";
    case "delete_event":
      return "删除日程";
    default:
      return tool;
  }
}

function formatArgsSummary(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const preview = entries.slice(0, 2).map(([k, v]) => `${k}: ${String(v)}`);
  if (entries.length > 2) preview.push("…");
  return preview.join(", ");
}
