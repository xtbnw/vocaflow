import Database from "better-sqlite3";
import type { CalendarRepository } from "../../domain/calendarRepository";
import {
  CalendarEventSchema,
  type CalendarEvent,
} from "../../domain/calendarTypes";

interface CalendarEventRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  notes: string | null;
  reminder_minutes_before: number | null;
  reminder_triggered: number | null;
  source: CalendarEvent["source"];
  created_at: string;
  updated_at: string;
}

export class SQLiteCalendarRepository implements CalendarRepository {
  private readonly database: Database.Database;

  constructor(filename: string) {
    this.database = new Database(filename);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        location TEXT,
        notes TEXT,
        reminder_minutes_before INTEGER,
        reminder_triggered INTEGER,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  async list(): Promise<CalendarEvent[]> {
    const rows = this.database
      .prepare("SELECT * FROM calendar_events ORDER BY start_at, id")
      .all() as CalendarEventRow[];

    return rows.map(toCalendarEvent);
  }

  async save(event: CalendarEvent): Promise<CalendarEvent> {
    const parsed = CalendarEventSchema.parse(event);
    this.upsert(parsed);
    return parsed;
  }

  async update(event: CalendarEvent): Promise<CalendarEvent> {
    return this.save(event);
  }

  async delete(id: string): Promise<void> {
    this.database.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
  }

  close(): void {
    this.database.close();
  }

  private upsert(event: CalendarEvent): void {
    this.database
      .prepare(`
        INSERT INTO calendar_events (
          id,
          title,
          start_at,
          end_at,
          location,
          notes,
          reminder_minutes_before,
          reminder_triggered,
          source,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @title,
          @startAt,
          @endAt,
          @location,
          @notes,
          @reminderMinutesBefore,
          @reminderTriggered,
          @source,
          @createdAt,
          @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          start_at = excluded.start_at,
          end_at = excluded.end_at,
          location = excluded.location,
          notes = excluded.notes,
          reminder_minutes_before = excluded.reminder_minutes_before,
          reminder_triggered = excluded.reminder_triggered,
          source = excluded.source,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      .run({
        ...event,
        location: event.location ?? null,
        notes: event.notes ?? null,
        reminderMinutesBefore: event.reminderMinutesBefore ?? null,
        reminderTriggered:
          event.reminderTriggered === undefined
            ? null
            : Number(event.reminderTriggered),
      });
  }
}

function toCalendarEvent(row: CalendarEventRow): CalendarEvent {
  return CalendarEventSchema.parse({
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location ?? undefined,
    notes: row.notes ?? undefined,
    reminderMinutesBefore: row.reminder_minutes_before ?? undefined,
    reminderTriggered:
      row.reminder_triggered === null
        ? undefined
        : Boolean(row.reminder_triggered),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
