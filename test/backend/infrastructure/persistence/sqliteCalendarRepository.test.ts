import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// ---------------------------------------------------------------------------
// claimDueReminders
// ---------------------------------------------------------------------------

test("claimDueReminders returns empty when no event has reminder", async () => {
  const repository = createRepository();
  await repository.save({
    ...event,
    reminderMinutesBefore: undefined,
    reminderTriggered: undefined,
  });

  const result = await repository.claimDueReminders("2026-05-30T10:00:00+08:00");
  assert.deepEqual(result, []);
});

test("claimDueReminders does not claim when reminder time not yet reached", async () => {
  const repository = createRepository();
  // Event at 10:00, 30min reminder => triggers at 09:30. Now is 09:00.
  await repository.save(event);

  const result = await repository.claimDueReminders("2026-05-30T09:00:00+08:00");
  assert.deepEqual(result, []);
});

test("claimDueReminders claims when reminder time is reached", async () => {
  const repository = createRepository();
  await repository.save(event);

  const result = await repository.claimDueReminders("2026-05-30T09:35:00+08:00");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, event.id);
  assert.equal(result[0].reminderTriggered, true);
});

test("claimDueReminders does not return already claimed reminders", async () => {
  const repository = createRepository();
  await repository.save(event);

  // First claim
  const first = await repository.claimDueReminders("2026-05-30T09:35:00+08:00");
  assert.equal(first.length, 1);

  // Second claim — should be empty
  const second = await repository.claimDueReminders("2026-05-30T09:40:00+08:00");
  assert.deepEqual(second, []);
});

test("claimDueReminders does not return events without reminderMinutesBefore", async () => {
  const repository = createRepository();
  const noReminder: CalendarEvent = {
    ...event,
    id: "no-reminder",
    reminderMinutesBefore: undefined,
    reminderTriggered: undefined,
  };
  await repository.save(event);
  await repository.save(noReminder);

  const result = await repository.claimDueReminders("2026-05-30T09:35:00+08:00");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, event.id);
});

test("claimDueReminders does not return already started events", async () => {
  const repository = createRepository();
  await repository.save(event);

  // Now is after the event started — no reminder returned
  const result = await repository.claimDueReminders("2026-05-30T10:30:00+08:00");
  assert.deepEqual(result, []);

  // Historical event was marked triggered — subsequent call still empty
  const result2 = await repository.claimDueReminders("2026-05-30T10:35:00+08:00");
  assert.deepEqual(result2, []);
});

test("claimDueReminders returns multiple due reminders sorted by start_at, id", async () => {
  const repository = createRepository();
  // events B and C both start at 10:30; at 10:26 both have triggered
  const eventB: CalendarEvent = {
    ...event,
    id: "b",
    title: "Event B",
    startAt: "2026-05-30T10:30:00+08:00",
    endAt: "2026-05-30T11:30:00+08:00",
    reminderMinutesBefore: 15,
    reminderTriggered: false,
  };
  const eventC: CalendarEvent = {
    ...event,
    id: "c",
    title: "Event C",
    startAt: "2026-05-30T10:30:00+08:00",
    endAt: "2026-05-30T11:30:00+08:00",
    reminderMinutesBefore: 10,
    reminderTriggered: false,
  };
  await repository.save(eventB);
  await repository.save(eventC);

  // Now = 10:26. B trigger = 10:15, C trigger = 10:20 — both due.
  // Same start_at → sorted by id: b < c
  const result = await repository.claimDueReminders("2026-05-30T10:26:00+08:00");
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "b");
  assert.equal(result[1].id, "c");
});

test("claimDueReminders sequential claims across two connections do not double-return the same reminder", async () => {
  // Unique temp directory so no collision across parallel test runs
  const tmpDir = mkdtempSync(join(tmpdir(), "vocaflow-test-"));
  const tmp = join(tmpDir, "test.sqlite");
  const repo1 = new SQLiteCalendarRepository(tmp);
  const repo2 = new SQLiteCalendarRepository(tmp);
  try {
    await repo1.save(event);

    // Two connections claim concurrently via Promise.all — only one should get the reminder.
    // This verifies the IMMEDIATE transaction serializes claims, not real lock-contention stress.
    const [r1, r2] = await Promise.all([
      repo1.claimDueReminders("2026-05-30T09:35:00+08:00"),
      repo2.claimDueReminders("2026-05-30T09:35:00+08:00"),
    ]);

    const total = r1.length + r2.length;
    assert.equal(total, 1, `expected exactly 1 reminder, got ${total}`);

    // Third claim should be empty
    const r3 = await repo1.claimDueReminders("2026-05-30T09:40:00+08:00");
    assert.deepEqual(r3, []);
  } finally {
    repo1.close();
    repo2.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
