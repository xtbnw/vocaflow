import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { CalendarEvent } from "../../../../backend/domain/calendarTypes";
import {
  CALENDAR_EVENTS_STORAGE_KEY,
  LocalStorageCalendarRepository,
} from "../../../../backend/infrastructure/persistence/localStorageCalendarRepository";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const storage = new MemoryStorage();
const repository = new LocalStorageCalendarRepository(storage);

const event: CalendarEvent = {
  id: "event-1",
  title: "Project review",
  startAt: "2026-05-30T10:00:00+08:00",
  endAt: "2026-05-30T11:00:00+08:00",
  source: "manual",
  createdAt: "2026-05-29T20:00:00+08:00",
  updatedAt: "2026-05-29T20:00:00+08:00",
};

beforeEach(() => {
  storage.clear();
});

test("returns an empty list when storage is empty or invalid", async () => {
  assert.deepEqual(await repository.list(), []);

  storage.setItem(CALENDAR_EVENTS_STORAGE_KEY, "{bad json");

  assert.deepEqual(await repository.list(), []);
});

test("saves events and lists them", async () => {
  const saved = await repository.save(event);

  assert.deepEqual(saved, event);
  assert.deepEqual(await repository.list(), [event]);
});

test("updates an existing event by id", async () => {
  await repository.save(event);

  const updated: CalendarEvent = {
    ...event,
    title: "Updated review",
    updatedAt: "2026-05-29T21:00:00+08:00",
  };

  assert.deepEqual(await repository.update(updated), updated);
  assert.deepEqual(await repository.list(), [updated]);
});

test("deletes events directly by id", async () => {
  const secondEvent: CalendarEvent = {
    ...event,
    id: "event-2",
    title: "Second event",
  };
  await repository.save(event);
  await repository.save(secondEvent);

  await repository.delete(event.id);

  assert.deepEqual(await repository.list(), [secondEvent]);
});
