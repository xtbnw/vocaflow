import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { CalendarEvent } from "../../../../backend/domain/calendarTypes";
import { SQLiteCalendarRepository } from "../../../../backend/infrastructure/persistence/sqliteCalendarRepository";

const repositories: SQLiteCalendarRepository[] = [];

function createRepository(): SQLiteCalendarRepository {
  const repository = new SQLiteCalendarRepository(":memory:");
  repositories.push(repository);
  return repository;
}

const event: CalendarEvent = {
  id: "event-1",
  title: "Project review",
  startAt: "2026-05-30T10:00:00+08:00",
  endAt: "2026-05-30T11:00:00+08:00",
  location: "Meeting room A",
  notes: "Review MVP progress",
  reminderMinutesBefore: 30,
  reminderTriggered: false,
  source: "manual",
  createdAt: "2026-05-29T20:00:00+08:00",
  updatedAt: "2026-05-29T20:00:00+08:00",
};

afterEach(() => {
  while (repositories.length > 0) {
    repositories.pop()!.close();
  }
});

test("returns an empty list for a new database", async () => {
  const repository = createRepository();

  assert.deepEqual(await repository.list(), []);
});

test("saves events and lists persisted optional fields", async () => {
  const repository = createRepository();

  assert.deepEqual(await repository.save(event), event);
  assert.deepEqual(await repository.list(), [event]);
});

test("save replaces an existing event with the same id", async () => {
  const repository = createRepository();
  await repository.save(event);

  const replacement: CalendarEvent = {
    ...event,
    title: "Revised project review",
    updatedAt: "2026-05-29T21:00:00+08:00",
  };

  assert.deepEqual(await repository.save(replacement), replacement);
  assert.deepEqual(await repository.list(), [replacement]);
});

test("update replaces an existing event by id", async () => {
  const repository = createRepository();
  await repository.save(event);

  const updated: CalendarEvent = {
    ...event,
    title: "Updated review",
    updatedAt: "2026-05-29T21:00:00+08:00",
  };

  assert.deepEqual(await repository.update(updated), updated);
  assert.deepEqual(await repository.list(), [updated]);
});

test("update inserts an event when the id does not exist", async () => {
  const repository = createRepository();

  assert.deepEqual(await repository.update(event), event);
  assert.deepEqual(await repository.list(), [event]);
});

test("deletes an event by id", async () => {
  const repository = createRepository();
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
