"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, Plus, RotateCcw } from "lucide-react";

import type { CalendarEvent } from "@/backend/domain/calendarTypes";
import {
  CALENDAR_EVENTS_STORAGE_KEY,
  LocalStorageCalendarRepository,
} from "@/backend/infrastructure/persistence/localStorageCalendarRepository";

const SMOKE_EVENT_ID = "local-storage-smoke-event";

function createSmokeEvent(): CalendarEvent {
  const now = new Date();
  const startAt = new Date(now.getTime() + 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

  return {
    id: SMOKE_EVENT_ID,
    title: "LocalStorage smoke event",
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    notes: "Used only to verify the localStorage repository.",
    source: "demo",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function LocalStorageRepositorySmoke() {
  const repository = useMemo(() => new LocalStorageCalendarRepository(), []);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rawStorage, setRawStorage] = useState<string>("");
  const [message, setMessage] = useState("Ready");

  const refresh = useCallback(async () => {
    const nextEvents = await repository.list();

    setEvents(nextEvents);
    setRawStorage(localStorage.getItem(CALENDAR_EVENTS_STORAGE_KEY) ?? "");
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveSmokeEvent() {
    await repository.save(createSmokeEvent());
    setMessage("Saved");
    await refresh();
  }

  async function deleteSmokeEvent() {
    await repository.delete(SMOKE_EVENT_ID);
    setMessage("Deleted");
    await refresh();
  }

  const smokeEvent = events.find((event) => event.id === SMOKE_EVENT_ID);

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-muted-foreground">
            localStorage Repository Smoke
          </h2>
          <p className="text-sm text-foreground">
            Events loaded: {events.length}. Smoke event:{" "}
            {smokeEvent ? "present" : "missing"}.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            type="button"
            onClick={saveSmokeEvent}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Save
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium"
            type="button"
            onClick={refresh}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            List
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium"
            type="button"
            onClick={deleteSmokeEvent}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Status: {message}. Key: {CALENDAR_EVENTS_STORAGE_KEY}
          </p>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
            {rawStorage || "(empty)"}
          </pre>
        </div>
      </div>
    </section>
  );
}
