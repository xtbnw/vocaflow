"use client";

import {
  Send,
  Mic,
  MicOff,
  CheckCircle2,
  XCircle,
  Wrench,
  ChevronUp,
  ChevronDown,
  Trash2,
  Clock,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionMessage } from "@/backend/domain/sessionTypes";
import { useAgentSession } from "@/frontend/hooks/useAgentSession";
import { useVoiceInput } from "@/frontend/hooks/useVoiceInput";
import { useCalendarEventsRefresh } from "@/frontend/hooks/useCalendarEvents";
import { ActionPreviewPanel } from "./ActionPreviewPanel";

export function VoiceCommandBar() {
  const [collapsed, setCollapsed] = useState(true);
  const triggerRefresh = useCalendarEventsRefresh();

  const {
    messages,
    pendingAction,
    isSubmitting,
    isExecutingPending,
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
  } = useVoiceInput();

  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = inputText.trim();
    if (!text || isSubmitting) return;

    setInputText("");
    setCollapsed(false);
    await submitText(text);
  };

  const handleClearSession = () => {
    clearSession();
    setCollapsed(true);
  };

  const hasMessages = messages.length > 0;
  const latestMessage = hasMessages ? messages[messages.length - 1] : null;

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
            voiceSupported
              ? isListening
                ? "border-red-300 bg-red-100 text-red-500 animate-pulse"
                : "vf-glass border-white/50 text-[#625f50] hover:scale-105 hover:bg-[#fff9e6]"
              : "vf-glass cursor-not-allowed border-white/30 text-[#49473f]/30"
          }`}
          disabled={!voiceSupported}
          onClick={toggleListening}
          title={
            voiceSupported
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
            placeholder={isSubmitting ? "处理中..." : "输入指令..."}
            type="text"
            value={inputText}
            disabled={isSubmitting}
          />
          <button
            className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fff9e6] text-[#625f50] transition-colors hover:bg-[#e8e2d0] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!inputText.trim() || isSubmitting}
            type="submit"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

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

    case "tool":
      return (
        <div className="mb-2 flex justify-start">
          <div
            className={`max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm shadow-sm ${
              message.success
                ? "bg-[#e8f5e9]/80 text-[#1c1b1b]"
                : "bg-[#ffdad6]/60 text-[#ba1a1a]"
            }`}
          >
            <div className="mb-1 flex items-center gap-1.5">
              {message.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className="text-[10px] font-medium uppercase tracking-widest text-[#49473f]/60">
                {message.success ? "执行成功" : "执行失败"}
              </span>
            </div>
            <p className="whitespace-pre-line">{message.message}</p>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#49473f]/50">
              <Wrench className="h-3 w-3" />
              <span>{toolLabel(message.toolName)}</span>
            </div>
          </div>
        </div>
      );
  }
}

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
