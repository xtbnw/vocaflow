"use client";

import { CalendarEventsProvider } from "@/frontend/hooks/useCalendarEvents";

export function Providers({ children }: { children: React.ReactNode }) {
  return <CalendarEventsProvider>{children}</CalendarEventsProvider>;
}
