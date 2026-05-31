"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CalendarEvent } from "@/backend/domain/calendarTypes";

interface CalendarEventsResponse {
  events: CalendarEvent[];
}

const CalendarEventsContext = createContext<CalendarEvent[]>([]);
const CalendarEventsRefreshContext = createContext<() => void>(() => {});

/** Only the latest refresh response may update the shared calendar snapshot. */
export function shouldApplyCalendarEventsResponse(
  requestId: number,
  latestRequestId: number,
): boolean {
  return requestId === latestRequestId;
}

export function CalendarEventsProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const latestRequestIdRef = useRef(0);

  const refreshEvents = useCallback(() => {
    const requestId = ++latestRequestIdRef.current;

    void fetch("/api/events", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("日程加载失败");
        return res.json() as Promise<CalendarEventsResponse>;
      })
      .then((data) => {
        if (shouldApplyCalendarEventsResponse(requestId, latestRequestIdRef.current)) {
          setEvents(data.events);
        }
      })
      .catch(() => {
        // Keep the current snapshot. Agent chat and voice state must remain unaffected.
      });
  }, []);

  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);

  return (
    <CalendarEventsRefreshContext.Provider value={refreshEvents}>
      <CalendarEventsContext.Provider value={events}>
        {children}
      </CalendarEventsContext.Provider>
    </CalendarEventsRefreshContext.Provider>
  );
}

export function useCalendarEventsRefresh() {
  return useContext(CalendarEventsRefreshContext);
}

export function useCalendarEvents() {
  return useContext(CalendarEventsContext);
}
