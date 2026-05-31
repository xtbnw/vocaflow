"use client";

import { Bell, Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatLocalTime } from "@/backend/shared/timeUtils";
import {
  getNotificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
} from "@/frontend/infrastructure/notification/browserNotification";
import { useInAppReminders } from "@/frontend/hooks/useInAppReminders";

const AUTO_DISMISS_MS = 8_000;

export function ReminderToastHost() {
  const { nextReminder, dismissCurrent } = useInAppReminders();

  return nextReminder ? (
    <ReminderToastItem
      key={nextReminder.id}
      reminder={nextReminder}
      onDismiss={dismissCurrent}
    />
  ) : null;
}

function ReminderToastItem({
  reminder,
  onDismiss,
}: {
  reminder: NonNullable<ReturnType<typeof useInAppReminders>["nextReminder"]>;
  onDismiss: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setPermission] = useState(getNotificationPermission());

  const dismiss = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [dismiss]);

  // Show browser notification if permission granted
  useEffect(() => {
    showBrowserNotification(
      `提醒: ${reminder.title}`,
      `开始时间: ${formatLocalTime(reminder.startAt)}`,
    );
  }, [reminder.title, reminder.startAt]);

  const handleEnableNotification = async () => {
    const perm = await requestNotificationPermission();
    setPermission(perm);
  };

  const showEnableButton = getNotificationPermission() === "default";

  return (
    <div className="pointer-events-auto fixed bottom-28 left-1/2 z-50 w-full max-w-[420px] -translate-x-1/2 px-4">
      <div className="vf-glass rounded-2xl border border-white/30 p-4 shadow-lg animate-in">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fff9e6]">
            <Bell className="h-4 w-4 text-[#625f50]" />
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-[#1c1b1b]">
              {reminder.title}
            </h4>
            <p className="mt-0.5 text-xs text-[#49473f]/60">
              开始时间: {formatLocalTime(reminder.startAt)}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                className="rounded-full bg-[#e8f5e9] px-4 py-1.5 text-xs font-medium text-[#2e7d32] transition-colors hover:bg-[#c8e6c9]"
                onClick={dismiss}
              >
                <Check className="mr-1 inline h-3 w-3" />
                知道了
              </button>

              {showEnableButton && (
                <button
                  className="rounded-full bg-[#f6f3f2] px-3 py-1.5 text-xs text-[#49473f] transition-colors hover:bg-[#e5e2e1]"
                  onClick={handleEnableNotification}
                >
                  开启系统通知
                </button>
              )}
            </div>
          </div>

          <button
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#49473f]/40 transition-colors hover:bg-[#e5e2e1]/50 hover:text-[#49473f]"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
