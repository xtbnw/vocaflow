import type { CalendarRepository } from "../../domain/calendarRepository";
import {
  CalendarEventSchema,
  type CalendarEvent,
} from "../../domain/calendarTypes";
import { z } from "zod";

export const CALENDAR_EVENTS_STORAGE_KEY = "vocaflow.calendar.events";

const CalendarStorageSchema = z.object({
  events: z.array(CalendarEventSchema),
});

type CalendarStorage = z.infer<typeof CalendarStorageSchema>;

export class LocalStorageCalendarRepository implements CalendarRepository {
  constructor(private readonly storage: Storage | null = getBrowserStorage()) {}

  async list(): Promise<CalendarEvent[]> {
    return this.readEvents();
  }

  async save(event: CalendarEvent): Promise<CalendarEvent> {
    const events = this.readEvents();

    this.writeEvents([...events, event]);

    return event;
  }

  async update(event: CalendarEvent): Promise<CalendarEvent> {
    const events = this.readEvents();
    const existingIndex = events.findIndex((item) => item.id === event.id);

    if (existingIndex === -1) {
      this.writeEvents([...events, event]);
      return event;
    }

    const nextEvents = [...events];
    nextEvents[existingIndex] = event;
    this.writeEvents(nextEvents);

    return event;
  }

  async delete(id: string): Promise<void> {
    const events = this.readEvents();

    this.writeEvents(events.filter((event) => event.id !== id));
  }

  private readEvents(): CalendarEvent[] {
    if (!this.storage) {
      return [];
    }

    try {
      const raw = this.storage.getItem(CALENDAR_EVENTS_STORAGE_KEY);

      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      const result = CalendarStorageSchema.safeParse(parsed);

      return result.success ? result.data.events : [];
    } catch {
      return [];
    }
  }

  private writeEvents(events: CalendarEvent[]): void {
    if (!this.storage) {
      return;
    }

    const storage: CalendarStorage = { events };

    try {
      this.storage.setItem(
        CALENDAR_EVENTS_STORAGE_KEY,
        JSON.stringify(storage),
      );
    } catch {
      return;
    }
  }
}

function getBrowserStorage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage;
  } catch {
    return null;
  }
}
