"use client";

import {
  Send,
  Mic,
  MicOff,
  CheckCircle2,
  XCircle,
  Wrench,
  MessageCircle,
  HelpCircle,
  AlertTriangle,
  X,
  ChevronUp,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SessionMessage } from "@/backend/domain/sessionTypes";
import type { OrchestratorResult } from "@/backend/app/commandOrchestrator";
import type { ToolExecutionResult } from "@/backend/domain/toolExecutionResult";
import {
  createSession,
  addMessage,
  endSession,
  makeUserMessage,
  makeAssistantMessage,
  makeToolMessage,
} from "@/backend/app/sessionManager";
import { ToolExecutor } from "@/backend/app/toolExecutor";
import { createDefaultToolRegistry } from "@/backend/domain/toolRegistry";
import { LocalStorageCalendarRepository } from "@/backend/infrastructure/persistence/localStorageCalendarRepository";
import { getASRProvider } from "@/backend/infrastructure/asr/asrProviderFactory";

const SESSION_STORAGE_KEY = "vocaflow.currentSession";
const COLLAPSE_DELAY_S = 10;

export function VoiceCommandBar() {
  const [session, setSession] = useState<Session | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.status === "active" && Array.isArray(parsed.messages)) {
        return parsed as Session;
      }
    } catch {
      /* ignore */
    }
    return null;
  });

  const [inputText, setInputText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapseCountdown, setCollapseCountdown] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  useEffect(() => {
    const asr = getASRProvider();
    setVoiceSupported(asr.isSupported());
  }, []);

  const messageListRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const executorRef = useRef<ToolExecutor | null>(null);
  if (!executorRef.current) {
    const repo = new LocalStorageCalendarRepository();
    const registry = createDefaultToolRegistry(repo);
    executorRef.current = new ToolExecutor(registry, repo);
  }

  const asrRef = useRef<ReturnType<typeof getASRProvider>>(null);
  if (!asrRef.current) {
    asrRef.current = getASRProvider();
  }

  // persist session
  useEffect(() => {
    if (!session || session.messages.length === 0) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  }, [session]);

  // auto-scroll on new messages
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages]);

  // collapse countdown
  useEffect(() => {
    if (collapseCountdown === null || collapseCountdown <= 0) return;

    countdownRef.current = setInterval(() => {
      setCollapseCountdown((prev) => {
        if (prev === null || prev <= 1) {
          setCollapsed(true);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [collapseCountdown]);

  const clearSession = useCallback(() => {
    setSession(null);
    setCollapsed(false);
    setCollapseCountdown(null);
  }, []);

  // wire ASR callbacks
  const committedRef = useRef("");
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

  const submitText = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = inputText.trim();
    if (!text || isSubmitting) return;

    setIsSubmitting(true);
    setInputText("");
    if (collapsed) setCollapsed(false);

    const userMsg = makeUserMessage(text);
    let cur = session ?? createSession();
    const history = cur.messages; // messages before this one
    cur = addMessage(cur, userMsg);
    setSession(cur);

    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, messages: history }),
      });
      const data: OrchestratorResult = await res.json();
      await handleOrchestratorResult(data, cur, text);
    } catch {
      const errMsg = makeAssistantMessage(
        "请求失败，请稍后重试",
        "unknown",
      );
      setSession((s) => (s ? addMessage(s, errMsg) : s));
    } finally {
      setIsSubmitting(false);
    }
  };

  async function handleOrchestratorResult(
    data: OrchestratorResult,
    currentSession: Session,
    userText: string,
  ) {
    switch (data.kind) {
      case "chat": {
        const msg = makeAssistantMessage(data.message, "chat");
        setSession(addMessage(currentSession, msg));
        break;
      }
      case "clarification": {
        const msg = makeAssistantMessage(
          data.clarificationQuestion,
          "clarification",
        );
        setSession(addMessage(currentSession, msg));
        break;
      }
      case "unknown": {
        const msg = makeAssistantMessage(
          data.reason ?? "未能理解您的意图",
          "unknown",
        );
        setSession(addMessage(currentSession, msg));
        break;
      }
      case "error": {
        const msg = makeAssistantMessage(data.message, "unknown");
        setSession(addMessage(currentSession, msg));
        break;
      }
      case "tool_call": {
        const assistantMsg = makeAssistantMessage(
          `正在执行${toolLabel(data.tool)}…`,
          "tool_call",
          data.tool,
          data.arguments as Record<string, unknown>,
        );
        let cur = addMessage(currentSession, assistantMsg);

        try {
          const execResult: ToolExecutionResult = await executorRef.current!.execute(
            data.tool,
            data.arguments,
          );
          const toolMsg = makeToolMessage(
            data.tool,
            data.arguments as Record<string, unknown>,
            execResult.success,
            execResult.message,
          );
          cur = addMessage(cur, toolMsg);

          if (execResult.success) {
            window.dispatchEvent(new CustomEvent("vocaflow:events-changed"));
          }
        } catch {
          const toolMsg = makeToolMessage(
            data.tool,
            data.arguments as Record<string, unknown>,
            false,
            "工具执行失败",
          );
          cur = addMessage(cur, toolMsg);
        }

        cur = endSession(cur);
        setSession(cur);
        setCollapseCountdown(COLLAPSE_DELAY_S);
        break;
      }
    }
  }

  const messages = session?.messages ?? [];
  const hasMessages = messages.length > 0;
  const showMessages = hasMessages && !collapsed;
  const sessionCompleted = session?.status === "completed";

  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pb-4">
      {/* message stream */}
      {showMessages && (
        <div className="pointer-events-auto mb-2 flex w-full max-w-[760px] flex-col">
          <div
            className="vf-glass max-h-[40vh] overflow-y-auto rounded-2xl border border-white/30 p-3 shadow-sm"
            ref={messageListRef}
          >
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>

          {/* collapse countdown bar */}
          {sessionCompleted && collapseCountdown !== null && (
            <div className="mt-2 flex items-center justify-between rounded-xl bg-[#f6f3f2]/90 px-4 py-2 text-xs text-[#49473f] backdrop-blur-sm">
              <span>
                会话已完成 · {collapseCountdown} 秒后自动收起
              </span>
              <button
                className="rounded-full px-3 py-1 text-[#ba1a1a] transition-colors hover:bg-[#ffdad6]/50"
                onClick={clearSession}
              >
                删除
              </button>
            </div>
          )}
        </div>
      )}

      {/* collapsed session indicator */}
      {collapsed && sessionCompleted && (
        <div className="pointer-events-auto mb-2 flex w-full max-w-[760px] items-center justify-between rounded-xl bg-[#f6f3f2]/90 px-4 py-2 text-xs text-[#49473f] backdrop-blur-sm">
          <span>上一次会话已完成</span>
          <div className="flex gap-2">
            <button
              className="rounded-full px-3 py-1 transition-colors hover:bg-[#e5e2e1]/50"
              onClick={() => {
                setCollapsed(false);
                setCollapseCountdown(null);
              }}
            >
              展开
            </button>
            <button
              className="rounded-full px-3 py-1 text-[#ba1a1a] transition-colors hover:bg-[#ffdad6]/50"
              onClick={clearSession}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {/* input bar */}
      <div className="pointer-events-auto flex w-full max-w-[760px] items-center justify-center gap-3">
        {/* voice mic button */}
        <button
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-200 ${
            voiceSupported
              ? isListening
                ? "border-red-300 bg-red-100 text-red-500 animate-pulse"
                : "vf-glass border-white/50 text-[#625f50] hover:scale-105 hover:bg-[#fff9e6]"
              : "vf-glass cursor-not-allowed border-white/30 text-[#49473f]/30"
          }`}
          disabled={!voiceSupported}
          onClick={() => {
            if (!voiceSupported) return;
            const asr = asrRef.current;
            if (!asr) return;

            if (isListening) {
              asr.stop();
              setIsListening(false);
            } else {
              committedRef.current = "";
              setInputText("");
              asr.start();
              setIsListening(true);
            }
          }}
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

        {/* text input */}
        <form
          className="vf-glass flex h-12 min-w-0 flex-1 items-center rounded-full border border-white/30 px-5 shadow-sm transition-colors focus-within:border-[#625f50]/50"
          onSubmit={submitText}
        >
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-sm text-[#1c1b1b] outline-none placeholder:text-[#49473f]/50 focus:ring-0"
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              isSubmitting
                ? "处理中..."
                : session?.status === "active" &&
                    session.messages.some(
                      (m) =>
                        m.kind === "assistant" &&
                        m.resultKind === "clarification",
                    )
                  ? "补充信息..."
                  : "输入指令..."
            }
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

// -- Message bubble renderers --

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
              message.resultKind === "tool_call"
                ? "bg-[#e8e2d0]/60 text-[#1c1b1b]"
                : message.resultKind === "clarification"
                  ? "bg-[#f6f3f2] text-[#1c1b1b] border border-[#e4e3da]/80"
                  : message.resultKind === "unknown"
                    ? "bg-[#ffdad6]/40 text-[#ba1a1a]"
                    : "bg-[#f6f3f2] text-[#1c1b1b]"
            }`}
          >
            <div className="mb-1 flex items-center gap-1.5">
              {assistantIcon(message.resultKind)}
              <span className="text-[10px] font-medium uppercase tracking-widest text-[#49473f]/60">
                {assistantLabel(message.resultKind)}
              </span>
            </div>
            <p>{message.content}</p>
            {message.resultKind === "tool_call" && message.tool && (
              <div className="mt-2 rounded-lg bg-white/50 px-3 py-1.5 text-[11px] text-[#625f50]">
                <span className="font-medium">{toolLabel(message.tool)}</span>
                {message.arguments && (
                  <span className="ml-2 text-[#49473f]/60">
                    {formatArgsSummary(message.arguments)}
                  </span>
                )}
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
            <p>{message.message}</p>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#49473f]/50">
              <Wrench className="h-3 w-3" />
              <span>{toolLabel(message.toolName)}</span>
            </div>
          </div>
        </div>
      );
  }
}

// -- helpers --

function assistantIcon(
  kind: "clarification" | "chat" | "unknown" | "tool_call",
) {
  switch (kind) {
    case "clarification":
      return <HelpCircle className="h-3 w-3 text-[#625f50]" />;
    case "chat":
      return <MessageCircle className="h-3 w-3 text-[#625f50]" />;
    case "unknown":
      return <AlertTriangle className="h-3 w-3 text-[#ba1a1a]" />;
    case "tool_call":
      return <Wrench className="h-3 w-3 text-[#625f50]" />;
  }
}

function assistantLabel(
  kind: "clarification" | "chat" | "unknown" | "tool_call",
) {
  switch (kind) {
    case "clarification":
      return "需要补充";
    case "chat":
      return "对话";
    case "unknown":
      return "无法理解";
    case "tool_call":
      return "工具调用";
  }
}

function toolLabel(tool: string): string {
  switch (tool) {
    case "create_event":
      return "创建日程";
    case "query_events":
      return "查询日程";
    case "find_events_for_delete":
      return "查找待删除日程";
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
