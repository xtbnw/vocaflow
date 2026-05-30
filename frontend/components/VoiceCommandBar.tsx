"use client";

import { Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { CommandResultPanel } from "@/frontend/components/CommandResultPanel";
import type { OrchestratorResult } from "@/backend/app/commandOrchestrator";
import type { ToolExecutionResult } from "@/backend/domain/toolExecutionResult";
import { ToolExecutor } from "@/backend/app/toolExecutor";
import { createDefaultToolRegistry } from "@/backend/domain/toolRegistry";
import { LocalStorageCalendarRepository } from "@/backend/infrastructure/persistence/localStorageCalendarRepository";

type CommandResult = OrchestratorResult | ToolExecutionResult;

export function VoiceCommandBar() {
  const [voiceExpanded, setVoiceExpanded] = useState(true);
  const [voiceText, setVoiceText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);

  const executorRef = useRef<ToolExecutor | null>(null);
  if (!executorRef.current) {
    const repo = new LocalStorageCalendarRepository();
    const registry = createDefaultToolRegistry(repo);
    executorRef.current = new ToolExecutor(registry, repo);
  }

  const submitVoiceText = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = voiceText.trim();
    if (!text || isSubmitting) return;

    setIsSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data: OrchestratorResult = await res.json();
      await handleResult(data);
    } catch {
      setResult({ kind: "error", message: "请求失败，请稍后重试" });
    } finally {
      setIsSubmitting(false);
      setVoiceText("");
    }
  };

  async function handleResult(data: OrchestratorResult) {
    if (data.kind === "tool_call") {
      try {
        const execResult = await executorRef.current!.execute(data.tool, data.arguments);
        setResult(execResult);
        if (execResult.success) {
          window.dispatchEvent(new CustomEvent("vocaflow:events-changed"));
        }
      } catch {
        setResult({
          kind: "execution",
          success: false,
          tool: data.tool,
          message: "工具执行失败",
        });
      }
    } else {
      setResult(data);
    }
  }

  const dismissResult = () => setResult(null);

  const placeholder = result?.kind === "clarification"
    ? "补充信息..."
    : "Type intent...";

  return (
    <div className="pointer-events-none fixed bottom-8 left-0 right-0 z-50 flex flex-col items-center gap-3 px-4">
      <div
        className={
          voiceExpanded
            ? "flex w-full max-w-2xl translate-y-0 flex-row items-center justify-center gap-2 opacity-100 transition-all duration-300"
            : "pointer-events-none flex w-full max-w-2xl translate-y-4 flex-row items-center justify-center gap-2 opacity-0 transition-all duration-300"
        }
      >
        <button className="vf-glass pointer-events-auto whitespace-nowrap rounded-full border border-[#625f50]/20 px-5 py-2 text-xs font-medium tracking-[0.05em] text-[#1c1b1b] shadow-sm transition-colors hover:bg-[#fff9e6]/50">
          Allow (允许)
        </button>
        <button className="vf-glass pointer-events-auto whitespace-nowrap rounded-full border border-[#ba1a1a]/20 px-5 py-2 text-xs font-medium tracking-[0.05em] text-[#ba1a1a] shadow-sm transition-colors hover:bg-[#ffdad6]/50">
          Decline (拒绝)
        </button>
        <button className="vf-glass pointer-events-auto whitespace-nowrap rounded-full border border-[#5f5f58]/20 px-5 py-2 text-xs font-medium tracking-[0.05em] text-[#1c1b1b] shadow-sm transition-colors hover:bg-[#e5e2e1]/50">
          Modify (修改)
        </button>
      </div>

      {result && <CommandResultPanel result={result} onDismiss={dismissResult} />}

      <div className="pointer-events-auto flex w-full max-w-[760px] items-center justify-center gap-3">
        <div className={`vf-glass vf-voice-bar ambient-glow relative flex h-16 items-center overflow-hidden rounded-full p-1 ${voiceExpanded ? "expanded pr-6" : ""}`}>
          <button
            className={`z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/50 shadow-sm transition-all duration-300 hover:scale-105 ${voiceExpanded ? "bg-[#ffdad6] text-[#93000a]" : "pulse-ring bg-[#fff9e6] text-[#1e1c11]"}`}
            onClick={() => setVoiceExpanded((value) => !value)}
          >
            <VoiceMicIcon />
          </button>
          <div className={`flex h-full flex-1 items-center justify-between pl-4 transition-opacity duration-300 ${voiceExpanded ? "opacity-100" : "opacity-0"}`}>
            <div className="flex h-6 w-16 shrink-0 items-end gap-1">
              {[24, 16, 24, 12, 20, 8].map((height, index) => (
                <div className="wave-bar w-1.5 rounded-full bg-[#625f50]" key={index} style={{ height }} />
              ))}
            </div>
            <div className="transcription-scroll relative ml-4 flex h-full flex-1 items-center overflow-hidden">
              <div className="absolute inset-0 flex items-center">
                <span className="animate-scroll whitespace-nowrap text-base text-[#1c1b1b]">
                  &quot;Schedule a gym session for tomorrow evening...&quot;
                </span>
              </div>
            </div>
            <button className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5e5e5d] transition-colors hover:bg-[#e5e2e1]/50" onClick={() => setVoiceExpanded(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <form className="vf-glass flex h-16 min-w-0 flex-1 items-center rounded-full border border-white/30 px-5 shadow-sm transition-colors focus-within:border-[#625f50]/50" onSubmit={submitVoiceText}>
          <input
            className="min-w-0 flex-1 border-none bg-transparent p-0 text-sm text-[#1c1b1b] outline-none placeholder:text-[#49473f]/50 focus:ring-0"
            onChange={(event) => setVoiceText(event.target.value)}
            placeholder={isSubmitting ? "处理中..." : placeholder}
            type="text"
            value={voiceText}
            disabled={isSubmitting}
          />
          <button
            className="ml-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fff9e6] text-[#625f50] transition-colors hover:bg-[#e8e2d0] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!voiceText.trim() || isSubmitting}
            type="submit"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function VoiceMicIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" focusable="false" viewBox="0 0 24 24">
      <path
        d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3Zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7Z"
        fill="currentColor"
      />
    </svg>
  );
}
