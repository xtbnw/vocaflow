"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { CalendarEvent } from "@/backend/domain/calendarTypes";

interface CalendarEventsContextValue {
  refreshTrigger: number;
  triggerRefresh: () => void;
}

const CalendarEventsContext = createContext<CalendarEventsContextValue>({
  refreshTrigger: 0,
  triggerRefresh: () => {},
});

export function CalendarEventsProvider({ children }: { children: React.ReactNode }) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshTrigger((n) => n + 1), []);
  return (
    <CalendarEventsContext.Provider value={{ refreshTrigger, triggerRefresh }}>
      {children}
    </CalendarEventsContext.Provider>
  );
}

export function useCalendarEventsRefresh() {
  const { triggerRefresh } = useContext(CalendarEventsContext);
  return triggerRefresh;
}

export function useCalendarEvents() {
  const { refreshTrigger } = useContext(CalendarEventsContext);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    fetch("/api/events")
      .then((res) => res.json())
      .then((data: { events: CalendarEvent[] }) => setEvents(data.events));
  }, [refreshTrigger]);

  return events;
}
