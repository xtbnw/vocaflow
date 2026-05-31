"use client";

import { CalendarEventsProvider } from "@/frontend/hooks/useCalendarEvents";
import { ReminderToastHost } from "@/frontend/components/ReminderToastHost";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CalendarEventsProvider>
      {children}
      <ReminderToastHost />
    </CalendarEventsProvider>
  );
}
