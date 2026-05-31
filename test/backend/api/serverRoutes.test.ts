import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  __overrideRuntimeForTest,
  __overrideRepositoryForTest,
  __resetForTest,
} from "../../../backend/bootstrap/serverDeepAgentsRuntime";
import type { AgentRuntime } from "../../../backend/domain/agentRuntime";
import type { CalendarEvent } from "../../../backend/domain/calendarTypes";

afterEach(() => {
  __resetForTest();
});

// ---------------------------------------------------------------------------
// DELETE /api/session
// ---------------------------------------------------------------------------

test("DELETE /api/session returns 400 when threadId is missing", async () => {
  const { DELETE } = await import("../../../app/api/session/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://localhost:3000/api/session", {
    method: "DELETE",
  });
  const res = await DELETE(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
});

test("DELETE /api/session calls deleteThread with valid threadId and returns ok", async () => {
  let deletedId: string | undefined;
  __overrideRuntimeForTest({
    kind: "mock",
    model: "mock",
    invoke: async () => ({ messages: [] }),
    stream: async function* () {},
    resume: async function* () {},
    deleteThread: async (id: string) => {
      deletedId = id;
    },
  } as AgentRuntime);

  const { DELETE } = await import("../../../app/api/session/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(
    "http://localhost:3000/api/session?id=thread-test-1",
    { method: "DELETE" },
  );
  const res = await DELETE(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.kind, "ok");
  assert.equal(deletedId, "thread-test-1");
});

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

test("GET /api/events returns repository.list() result", async () => {
  const mockEvents: CalendarEvent[] = [
    {
      id: "evt-1",
      title: "测试日程",
      startAt: "2026-06-01T09:00:00.000Z",
      endAt: "2026-06-01T10:00:00.000Z",
      source: "text",
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:00:00.000Z",
    },
  ];
  __overrideRepositoryForTest({
    list: async () => mockEvents,
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
  } as any);

  const { GET } = await import("../../../app/api/events/route");
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.deepEqual(body.events, mockEvents);
});

// ---------------------------------------------------------------------------
// Override isolation
// ---------------------------------------------------------------------------

test("repository override does not affect runtime deleteThread", async () => {
  let deletedId: string | undefined;
  __overrideRuntimeForTest({
    kind: "mock",
    model: "mock",
    invoke: async () => ({ messages: [] }),
    stream: async function* () {},
    resume: async function* () {},
    deleteThread: async (id: string) => {
      deletedId = id;
    },
  } as AgentRuntime);

  // Separately override repository — should not affect runtime
  __overrideRepositoryForTest({
    list: async () => [],
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
  } as any);

  const { DELETE } = await import("../../../app/api/session/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(
    "http://localhost:3000/api/session?id=thread-isolated",
    { method: "DELETE" },
  );
  const res = await DELETE(req);
  assert.equal(res.status, 200);
  assert.equal(deletedId, "thread-isolated");
});

test("runtime override does not affect repository list", async () => {
  const mockEvents: CalendarEvent[] = [
    {
      id: "evt-x",
      title: "独立日程",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-01T10:00:00.000Z",
      source: "text",
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:00:00.000Z",
    },
  ];

  // Override runtime — should not affect list()
  __overrideRuntimeForTest({
    kind: "mock",
    model: "mock",
    invoke: async () => ({ messages: [] }),
    stream: async function* () {},
    resume: async function* () {},
    deleteThread: async () => {},
  } as AgentRuntime);

  // Separately override repository
  __overrideRepositoryForTest({
    list: async () => mockEvents,
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
  } as any);

  const { GET } = await import("../../../app/api/events/route");
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.events, mockEvents);
});

// ---------------------------------------------------------------------------
// POST /api/reminders/claim-due
// ---------------------------------------------------------------------------

test("POST /api/reminders/claim-due returns { reminders } from repository", async () => {
  const mockReminders: CalendarEvent[] = [
    {
      id: "rem-1",
      title: "提醒日程",
      startAt: "2026-06-01T10:00:00.000Z",
      endAt: "2026-06-01T11:00:00.000Z",
      reminderMinutesBefore: 30,
      reminderTriggered: true,
      source: "text",
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:00:00.000Z",
    },
  ];
  __overrideRepositoryForTest({
    list: async () => [],
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
    claimDueReminders: async (_now: string) => mockReminders,
  } as any);

  const { POST } = await import(
    "../../../app/api/reminders/claim-due/route"
  );
  const res = await POST();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.reminders, mockReminders);
});

test("POST /api/reminders/claim-due uses server time (no client now param)", async () => {
  let capturedNow: string | undefined;
  __overrideRepositoryForTest({
    list: async () => [],
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
    claimDueReminders: async (now: string) => {
      capturedNow = now;
      return [];
    },
  } as any);

  const { POST } = await import(
    "../../../app/api/reminders/claim-due/route"
  );
  const res = await POST();
  assert.equal(res.status, 200);

  // Verify the route generated its own timestamp
  assert.ok(capturedNow !== undefined);
  const capturedMs = new Date(capturedNow!).getTime();
  const nowMs = Date.now();
  // Should be within a few seconds of now
  assert.ok(Math.abs(capturedMs - nowMs) < 5000);
});

test("POST /api/reminders/claim-due returns 500 on repository error", async () => {
  __overrideRepositoryForTest({
    list: async () => [],
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
    claimDueReminders: async () => {
      throw new Error("DB connection lost");
    },
  } as any);

  const { POST } = await import(
    "../../../app/api/reminders/claim-due/route"
  );
  const res = await POST();
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, "Failed to claim due reminders");
});
