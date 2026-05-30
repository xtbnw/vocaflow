import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolExecutor } from "../../../backend/app/toolExecutor";
import { ToolRegistry } from "../../../backend/domain/toolRegistry";
import type { PendingAction } from "../../../backend/app/types/pendingAction";
import { CreateEventArgsSchema } from "../../../backend/domain/calendarTypes";

function makePendingAction(overrides?: Partial<PendingAction>): PendingAction {
  return {
    id: "pa-1",
    type: "create_event",
    status: "pending",
    preview: {
      title: "创建日程",
      summary: "明天 15:00 - 16:00",
      items: [
        { label: "标题", value: "测试" },
        { label: "时间", value: "明天 15:00" },
      ],
    },
    payload: {
      title: "测试",
      startAt: "2026-05-31T15:00:00+08:00",
      endAt: "2026-05-31T16:00:00+08:00",
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createExecutor() {
  const registry = new ToolRegistry();
  registry.register({
    name: "create_event",
    schema: CreateEventArgsSchema,
    handler: async () => ({ action: "created", event: {} }),
  });
  return new ToolExecutor(registry);
}

test("removePendingAction deletes a stored pending action", () => {
  const executor = createExecutor();
  const pa = makePendingAction();
  executor.storePendingAction(pa);

  assert.ok(executor.getPendingAction(pa.id));
  executor.removePendingAction(pa.id);
  assert.equal(executor.getPendingAction(pa.id), undefined);
});

test("removePendingAction is idempotent", () => {
  const executor = createExecutor();
  executor.removePendingAction("nonexistent");
  // should not throw
});

test("cancelPendingAction followed by removePendingAction cleans up", () => {
  const executor = createExecutor();
  const pa = makePendingAction();
  executor.storePendingAction(pa);

  const cancelled = executor.cancelPendingAction(pa.id);
  assert.equal(cancelled, true);
  assert.equal(executor.getPendingAction(pa.id)?.status, "cancelled");

  executor.removePendingAction(pa.id);
  assert.equal(executor.getPendingAction(pa.id), undefined);
});

test("executePendingAction confirms, then removePendingAction cleans up", async () => {
  const executor = createExecutor();
  const pa = makePendingAction();
  executor.storePendingAction(pa);

  const result = await executor.executePendingAction(pa.id);
  assert.equal(result.kind, "execution");
  assert.equal(result.success, true);

  executor.removePendingAction(pa.id);
  assert.equal(executor.getPendingAction(pa.id), undefined);
});

test("cancelPendingAction cannot cancel already-executed action", () => {
  const executor = createExecutor();
  const pa = makePendingAction();
  executor.storePendingAction(pa);

  // Confirm first
  executor.cancelPendingAction(pa.id); // cancel first — succeeds
  assert.equal(executor.getPendingAction(pa.id)?.status, "cancelled");

  // Try to cancel again — should fail
  const result = executor.cancelPendingAction(pa.id);
  assert.equal(result, false);
});
