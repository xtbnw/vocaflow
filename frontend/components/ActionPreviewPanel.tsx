"use client";

import { Check, X, AlertTriangle, CalendarPlus, Trash2 } from "lucide-react";
import type { PendingAction } from "@/backend/domain/pendingAction";

interface ActionPreviewPanelProps {
  pendingAction: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function ActionPreviewPanel({
  pendingAction,
  onConfirm,
  onCancel,
  disabled,
}: ActionPreviewPanelProps) {
  const { preview, type } = pendingAction;

  return (
    <div className="vf-glass rounded-2xl border border-white/30 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {type === "create_event" ? (
          <CalendarPlus className="h-4 w-4 text-[#625f50]" />
        ) : (
          <Trash2 className="h-4 w-4 text-[#ba1a1a]" />
        )}
        <span className="text-xs font-medium uppercase tracking-widest text-[#49473f]/60">
          方案预览
        </span>
      </div>

      <h3 className="mb-1 text-sm font-semibold text-[#1c1b1b]">
        {preview.title}
      </h3>
      <p className="mb-3 text-xs text-[#49473f]/60">{preview.summary}</p>

      <div className="mb-3 space-y-1.5 rounded-xl bg-[#f6f3f2]/60 px-3 py-2.5">
        {preview.items.map((item) => (
          <div key={item.label} className="flex items-baseline gap-2 text-xs">
            <span className="shrink-0 text-[#49473f]/50">{item.label}</span>
            <span className="text-[#1c1b1b]">{item.value}</span>
          </div>
        ))}
      </div>

      {preview.warnings && preview.warnings.length > 0 && (
        <div className="mb-3 space-y-1 rounded-xl bg-[#fff3cd]/60 px-3 py-2.5">
          {preview.warnings.map((w) => (
            <div
              key={w}
              className="flex items-start gap-1.5 text-xs text-[#856404]"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#e8f5e9] px-4 py-2 text-sm font-medium text-[#2e7d32] transition-colors hover:bg-[#c8e6c9] disabled:opacity-40"
          onClick={onConfirm}
          disabled={disabled}
        >
          <Check className="h-4 w-4" />
          确认
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#ffdad6] px-4 py-2 text-sm font-medium text-[#ba1a1a] transition-colors hover:bg-[#ffcdd2] disabled:opacity-40"
          onClick={onCancel}
          disabled={disabled}
        >
          <X className="h-4 w-4" />
          取消
        </button>
      </div>
    </div>
  );
}
