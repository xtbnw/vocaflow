"use client";

import { X, MessageCircle, HelpCircle, AlertTriangle, Wrench } from "lucide-react";
import type { OrchestratorResult } from "@/backend/app/commandOrchestrator";

export function CommandResultPanel({
  result,
  onDismiss,
}: {
  result: OrchestratorResult;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-auto vf-glass mx-auto mb-3 w-full max-w-[760px] rounded-2xl border border-white/30 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-1">{renderResult(result)}</div>
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5e5e5d] transition-colors hover:bg-[#e5e2e1]/50"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function renderResult(result: OrchestratorResult) {
  switch (result.kind) {
    case "chat":
      return <ChatContent message={result.message} />;
    case "clarification":
      return <ClarificationContent question={result.clarificationQuestion} missingFields={result.missingFields} />;
    case "tool_call":
      return <ToolCallContent tool={result.tool} args={result.arguments} confidence={result.confidence} />;
    case "unknown":
      return <UnknownContent reason={result.reason} />;
    case "error":
      return <ErrorContent message={result.message} />;
  }
}

function ResultRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[#49473f]/60">
        {icon}
        {label}
      </div>
      <div className="text-sm text-[#1c1b1b]">{children}</div>
    </div>
  );
}

function ChatContent({ message }: { message: string }) {
  return (
    <ResultRow icon={<MessageCircle className="h-3.5 w-3.5" />} label="Chat">
      {message || "(empty)"}
    </ResultRow>
  );
}

function ClarificationContent({
  question,
  missingFields,
}: {
  question: string;
  missingFields?: string[];
}) {
  return (
    <ResultRow icon={<HelpCircle className="h-3.5 w-3.5" />} label="需要补充信息">
      <p className="mb-2">{question}</p>
      {missingFields && missingFields.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {missingFields.map((f) => (
            <span
              className="inline-block rounded-full border border-[#e4e3da]/80 bg-[#f6f3f2] px-2.5 py-0.5 text-[11px] text-[#625f50]"
              key={f}
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </ResultRow>
  );
}

function ToolCallContent({
  tool,
  args,
  confidence,
}: {
  tool: string;
  args: unknown;
  confidence?: number;
}) {
  const entries = extractArgsEntries(args);

  return (
    <ResultRow icon={<Wrench className="h-3.5 w-3.5" />} label={`Tool: ${toolLabel(tool)}`}>
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {entries.map(([key, value]) => (
            <li className="flex items-baseline gap-2" key={key}>
              <span className="text-[11px] font-medium text-[#49473f]/70">{key}</span>
              <span className="text-[13px] text-[#1c1b1b]">{String(value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[#49473f]/50 italic">无参数</span>
      )}
      {confidence !== undefined && (
        <span className="mt-2 inline-block text-[11px] text-[#49473f]/50">
          置信度 {(confidence * 100).toFixed(0)}%
        </span>
      )}
    </ResultRow>
  );
}

function extractArgsEntries(args: unknown): [string, unknown][] {
  if (!args || typeof args !== "object") return [];
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value !== undefined && value !== null && value !== "") {
      entries.push([key, formatArgValue(value)]);
    }
  }
  return entries;
}

function formatArgValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return JSON.stringify(value);
}

function UnknownContent({ reason }: { reason?: string }) {
  return (
    <ResultRow icon={<AlertTriangle className="h-3.5 w-3.5" />} label="无法理解">
      {reason || "未能识别指令意图"}
    </ResultRow>
  );
}

function ErrorContent({ message }: { message: string }) {
  return (
    <ResultRow icon={<AlertTriangle className="h-3.5 w-3.5" />} label="错误">
      {message}
    </ResultRow>
  );
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
