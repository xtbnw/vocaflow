import {
  type CalendarEvent,
  CalendarEventSchema,
  type CreateEventArgs,
  type DeleteEventArgs,
  type QueryEventsArgs,
} from "../domain/calendarTypes";
import type { CalendarRepository } from "../domain/calendarRepository";
import { newId, defaultEndAt, toTimestamp, isInRange } from "../shared/timeUtils";

export const createEventHandler = (repo: CalendarRepository) =>
  async (args: unknown) => {
    const a = args as CreateEventArgs;
    const now = new Date().toISOString();
    const event: CalendarEvent = CalendarEventSchema.parse({
      id: newId(),
      title: a.title,
      startAt: a.startAt,
      endAt: a.endAt ?? defaultEndAt(a.startAt),
      location: a.location,
      notes: a.notes,
      reminderMinutesBefore: a.reminderMinutesBefore,
      source: "text",
      createdAt: now,
      updatedAt: now,
    });
    const saved = await repo.save(event);
    return { action: "created", event: saved };
  };

export const queryEventsHandler = (repo: CalendarRepository) =>
  async (args: unknown) => {
    const a = args as QueryEventsArgs;
    const all = await repo.list();
    let filtered = all.filter((e) => isInRange(e.startAt, e.endAt, a.rangeStartAt, a.rangeEndAt));
    if (a.keyword) {
      const kw = a.keyword.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(kw) ||
          (e.notes && e.notes.toLowerCase().includes(kw)),
      );
    }
    filtered.sort((x, y) => toTimestamp(x.startAt) - toTimestamp(y.startAt));
    return { action: "queried", events: filtered };
  };

export const deleteEventHandler = (repo: CalendarRepository) =>
  async (args: unknown) => {
    const a = args as DeleteEventArgs;
    const results: { id: string; success: boolean }[] = [];
    for (const id of a.eventIds) {
      try {
        await repo.delete(id);
        results.push({ id, success: true });
      } catch {
        results.push({ id, success: false });
      }
    }
    const deleted = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return { action: "deleted", deleted, failed, results };
  };
