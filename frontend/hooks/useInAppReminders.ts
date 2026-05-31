"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@/backend/domain/calendarTypes";

export const POLL_INTERVAL_MS = 30_000;

export interface ReminderQueue {
  /** Append reminders to the display queue. */
  enqueue(events: CalendarEvent[]): void;
  /** Remove and return the next reminder, or null. */
  dequeue(): CalendarEvent | null;
  /** Peek at the next reminder, or null. */
  peek(): CalendarEvent | null;
}

export interface ReminderFetchResult {
  reminders: CalendarEvent[];
}

export type ReminderFetchFn = () => Promise<ReminderFetchResult>;

export interface PollerConfig {
  fetchFn: ReminderFetchFn;
  onReminders: (reminders: CalendarEvent[]) => void;
  intervalMs: number;
  /** AbortSignal to stop the poller externally. */
  signal: AbortSignal;
  deps?: ReminderPollerDeps;
}

export interface ReminderVisibilityTarget {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface ReminderPollerDeps {
  setIntervalFn: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn: (intervalId: ReturnType<typeof setInterval>) => void;
  visibilityTarget?: ReminderVisibilityTarget;
}

export interface ReminderPoller {
  /** Trigger a manual poll (also called automatically on start and interval). */
  poll(): Promise<void>;
}

/**
 * Pure queue implementation so the queue logic can be tested without React.
 */
export function createReminderQueue(): ReminderQueue {
  const items: CalendarEvent[] = [];
  const seen = new Set<string>();

  return {
    enqueue(events: CalendarEvent[]) {
      for (const e of events) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        items.push(e);
      }
    },
    dequeue(): CalendarEvent | null {
      return items.shift() ?? null;
    },
    peek(): CalendarEvent | null {
      return items.length > 0 ? items[0] : null;
    },
  };
}

/**
 * Pure polling controller — testable without React.
 *
 * - Calls poll() immediately on start.
 * - Repeats every intervalMs.
 * - Re-polls on visibilitychange → visible.
 * - At most one in-flight request at a time.
 * - Stops when the AbortSignal fires.
 * - Errors are silently ignored.
 */
export function createReminderPoller(config: PollerConfig): ReminderPoller {
  let polling = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const deps = config.deps ?? browserPollerDeps();

  const doPoll = async () => {
    if (config.signal.aborted || polling) return;
    polling = true;
    try {
      const result = await config.fetchFn();
      if (config.signal.aborted) return;
      if (result.reminders.length > 0) {
        config.onReminders(result.reminders);
      }
    } catch {
      // ignore — retry on next interval
    } finally {
      polling = false;
    }
  };

  if (config.signal.aborted) {
    return { poll: doPoll };
  }

  // Immediate first poll
  void doPoll();

  // Periodic poll
  intervalId = deps.setIntervalFn(() => void doPoll(), config.intervalMs);

  // Visibility change
  const onVisible = () => {
    if (deps.visibilityTarget?.visibilityState === "visible") {
      void doPoll();
    }
  };
  deps.visibilityTarget?.addEventListener("visibilitychange", onVisible);

  // Stop on signal
  const onAbort = () => {
    if (intervalId !== null) {
      deps.clearIntervalFn(intervalId);
      intervalId = null;
    }
    deps.visibilityTarget?.removeEventListener("visibilitychange", onVisible);
    config.signal.removeEventListener("abort", onAbort);
  };
  config.signal.addEventListener("abort", onAbort);

  return { poll: doPoll };
}

function browserPollerDeps(): ReminderPollerDeps {
  return {
    setIntervalFn: (callback, intervalMs) => setInterval(callback, intervalMs),
    clearIntervalFn: (intervalId) => clearInterval(intervalId),
    visibilityTarget:
      typeof document === "undefined" ? undefined : document,
  };
}

interface UseInAppRemindersResult {
  nextReminder: CalendarEvent | null;
  dismissCurrent: () => void;
}

/**
 * React hook: poll /api/reminders/claim-due, manage a reminder queue.
 */
export function useInAppReminders(
  fetchFn: ReminderFetchFn = defaultFetch,
): UseInAppRemindersResult {
  const queueRef = useRef<ReminderQueue>(createReminderQueue());
  const [nextReminder, setNextReminder] = useState<CalendarEvent | null>(null);

  const dismissCurrent = useCallback(() => {
    queueRef.current.dequeue();
    setNextReminder(queueRef.current.peek());
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const poller = createReminderPoller({
      fetchFn,
      intervalMs: POLL_INTERVAL_MS,
      signal: controller.signal,
      onReminders: (reminders) => {
        queueRef.current.enqueue(reminders);
        setNextReminder(queueRef.current.peek());
      },
    });

    return () => {
      controller.abort();
    };
  }, [fetchFn]);

  return { nextReminder, dismissCurrent };
}

async function defaultFetch(): Promise<ReminderFetchResult> {
  const res = await fetch("/api/reminders/claim-due", { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
