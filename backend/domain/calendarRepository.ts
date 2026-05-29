import type { CalendarEvent } from "./calendarTypes";

export interface CalendarRepository {
  list(): Promise<CalendarEvent[]>;
  save(event: CalendarEvent): Promise<CalendarEvent>;
  update(event: CalendarEvent): Promise<CalendarEvent>;
  delete(id: string): Promise<void>;
}
