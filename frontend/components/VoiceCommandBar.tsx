"use client";

import {
  Send,
  Mic,
  MicOff,
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
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionMessage } from "@/backend/domain/sessionTypes";
import { useAgentSession, isCalendarTool, shouldStopVoice, type ToolActivity } from "@/frontend/hooks/useAgentSession";
import { useVoiceInput } from "@/frontend/hooks/useVoiceInput";
import { useCalendarEventsRefresh } from "@/frontend/hooks/useCalendarEvents";
import { ActionPreviewPanel } from "./ActionPreviewPanel";

export function VoiceCommandBar() {
  const [collapsed, setCollapsed] = useState(true);
  const triggerRefresh = useCalendarEventsRefresh();

  const {
    threadId: _threadId,
    messages,
    toolActivities,
    pendingAction,
    isSubmitting,
    isExecutingPending,
    error,
    submitText,
    confirmPending,
    cancelPending,
    clearSession,
  } = useAgentSession(triggerRefresh);

  const {
    inputText,
    setInputText,
    isListening,
    voiceSupported,
    toggleListening,
    stopListening,
  } = useVoiceInput();

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
    await submitText(text);
  };

  const hasBlocker = !!pendingAction || isExecutingPending;

  useEffect(() => {
    if (shouldStopVoice(hasBlocker, isListening)) {
      stopListening();
    }
  }, [hasBlocker, isListening, stopListening]);

  const handleClearSession = () => {
    clearSession();
    setCollapsed(true);
  };

  const hasMessages = messages.length > 0;
  const hasToolActivities = toolActivities.length > 0;
  const latestMessage = hasMessages ? messages[messages.length - 1] : null;
  const hasActiveTools = toolActivities.some((a) => a.status === "running");

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pb-4">
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

      <div className="pointer-events-auto flex w-full max-w-[760px] items-center justify-center gap-3">
        <button
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-200 ${
            hasBlocker
              ? "vf-glass cursor-not-allowed border-white/30 text-[#49473f]/30"
              : voiceSupported
                ? isListening
                  ? "border-red-300 bg-red-100 text-red-500 animate-pulse"
                  : "vf-glass border-white/50 text-[#625f50] hover:scale-105 hover:bg-[#fff9e6]"
                : "vf-glass cursor-not-allowed border-white/30 text-[#49473f]/30"
          }`}
          disabled={!voiceSupported || hasBlocker}
          onClick={hasBlocker ? undefined : toggleListening}
          title={
            hasBlocker
              ? "请先确认当前操作"
              : voiceSupported
                ? isListening
                  ? "停止录音"
                  : "语音输入"
                : "浏览器不支持语音识别"
          }
        >
          {voiceSupported ? (
            <Mic className="h-5 w-5" />
          ) : (
            <MicOff className="h-5 w-5" />
          )}
        </button>

        <form
          className="vf-glass flex h-12 min-w-0 flex-1 items-center rounded-full border border-white/30 px-5 shadow-sm transition-colors focus-within:border-[#625f50]/50"
          onSubmit={handleSubmit}
        >
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-sm text-[#1c1b1b] outline-none placeholder:text-[#49473f]/50 focus:ring-0"
            onChange={(e) => setInputText(e.target.value)}
            placeholder={isSubmitting ? "处理中..." : hasBlocker ? "请先确认当前操作" : "输入指令..."}
            type="text"
            value={inputText}
            disabled={isSubmitting || hasBlocker}
          />
          <button
            className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff9e6] text-[#625f50] transition-colors hover:bg-[#e8e2d0] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!inputText.trim() || isSubmitting || hasBlocker}
            type="submit"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
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
