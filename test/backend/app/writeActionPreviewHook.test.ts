import assert from "node:assert/strict";
import { test } from "node:test";

import { WriteActionPreviewHook } from "../../../backend/app/writeActionPreviewHook";
import type { CalendarRepository } from "../../../backend/domain/calendarRepository";
import type { CalendarEvent } from "../../../backend/domain/calendarTypes";

const existingEvent: CalendarEvent = {
  id: "existing-event",
  title: "数据库验收准备",
  startAt: "2026-05-30T15:00:00+08:00",
  endAt: "2026-05-30T16:00:00+08:00",
  source: "manual",
  createdAt: "2026-05-29T20:00:00+08:00",
  updatedAt: "2026-05-29T20:00:00+08:00",
};

class MemoryCalendarRepository implements CalendarRepository {
  constructor(private readonly events: CalendarEvent[] = []) {}

  async list(): Promise<CalendarEvent[]> {
    return this.events;
  }

  async save(event: CalendarEvent): Promise<CalendarEvent> {
    return event;
  }

  async update(event: CalendarEvent): Promise<CalendarEvent> {
    return event;
  }

  async delete(): Promise<void> {}
}

function createArgs(startAt: string, endAt?: string) {
  return {
    title: "项目讨论",
    startAt,
    endAt,
  };
}

async function getCreatePreview(
  repository: CalendarRepository,
  args: ReturnType<typeof createArgs>,
) {
  const hook = new WriteActionPreviewHook(repository);
  const decision = await hook.run({
    toolName: "create_event",
    args,
    source: "normal",
  });

  assert.equal(decision.kind, "intercept");
  assert.equal(decision.result.kind, "pending_action");
  return decision.result.pendingAction.preview;
}

test("creates a normal preview when the time range has no conflict", async () => {
  const preview = await getCreatePreview(
    new MemoryCalendarRepository([existingEvent]),
    createArgs("2026-05-30T13:00:00+08:00", "2026-05-30T14:00:00+08:00"),
  );

  assert.deepEqual(preview.warnings, undefined);
});

test("adds a warning when an existing event overlaps the candidate", async () => {
  const preview = await getCreatePreview(
    new MemoryCalendarRepository([existingEvent]),
    createArgs("2026-05-30T15:30:00+08:00", "2026-05-30T16:30:00+08:00"),
  );

  assert.deepEqual(preview.warnings, [
    '时间冲突：15:00-16:00 已有"数据库验收准备"',
  ]);
});

test("does not report a conflict when time ranges only touch at the boundary", async () => {
  const preview = await getCreatePreview(
    new MemoryCalendarRepository([existingEvent]),
    createArgs("2026-05-30T16:00:00+08:00", "2026-05-30T17:00:00+08:00"),
  );

  assert.deepEqual(preview.warnings, undefined);
});

test("uses the one hour default duration when checking conflicts", async () => {
  const preview = await getCreatePreview(
    new MemoryCalendarRepository([existingEvent]),
    createArgs("2026-05-30T14:30:00+08:00"),
  );

  assert.deepEqual(preview.warnings, [
    "未指定结束时间，将默认设置为开始时间后 1 小时",
    '时间冲突：15:00-16:00 已有"数据库验收准备"',
  ]);
});

test("rejects create preview when existing events cannot be loaded", async () => {
  const repository = new MemoryCalendarRepository();
  repository.list = async () => {
    throw new Error("storage unavailable");
  };

  const hook = new WriteActionPreviewHook(repository);
  const decision = await hook.run({
    toolName: "create_event",
    args: createArgs("2026-05-30T15:30:00+08:00", "2026-05-30T16:30:00+08:00"),
    source: "normal",
  });

  assert.deepEqual(decision, {
    kind: "reject",
    message: "无法读取已有日程，请稍后重试",
  });
});
