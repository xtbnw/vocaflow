import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentRunner } from "../../../backend/app/agentRunner";
import { ToolExecutor } from "../../../backend/app/toolExecutor";
import { WriteActionPreviewHook } from "../../../backend/app/writeActionPreviewHook";
import type { OrchestratorResult } from "../../../backend/app/commandOrchestrator";
import type { CalendarRepository } from "../../../backend/domain/calendarRepository";
import type { CalendarEvent } from "../../../backend/domain/calendarTypes";
import { ToolRegistry } from "../../../backend/domain/toolRegistry";
import {
  CreateEventArgsSchema,
  DeleteEventArgsSchema,
  QueryEventsArgsSchema,
} from "../../../backend/domain/calendarTypes";
import {
  createEventHandler,
  queryEventsHandler,
  deleteEventHandler,
} from "../../../backend/app/calendarToolHandlers";
import { makeUserMessage } from "../../../backend/app/sessionManager";

class MemoryCalendarRepository implements CalendarRepository {
  constructor(private events: CalendarEvent[] = []) {}

  async list(): Promise<CalendarEvent[]> {
    return [...this.events];
  }

  async save(event: CalendarEvent): Promise<CalendarEvent> {
    this.events = [...this.events.filter((item) => item.id !== event.id), event];
    return event;
  }

  async update(event: CalendarEvent): Promise<CalendarEvent> {
    return this.save(event);
  }

  async delete(id: string): Promise<void> {
    this.events = this.events.filter((event) => event.id !== id);
  }
}

class QueuedOrchestrator {
  readonly receivedTexts: string[] = [];

  constructor(private readonly results: OrchestratorResult[]) {}

  async process(text: string): Promise<OrchestratorResult> {
    this.receivedTexts.push(text);
    const result = this.results.shift();
    if (!result) throw new Error("No queued orchestrator result");
    return result;
  }
}

const context = {
  currentTime: "2026-05-30T12:00:00+08:00",
  timezone: "Asia/Shanghai",
};

function createRunner(
  repository: CalendarRepository,
  results: OrchestratorResult[],
) {
  const registry = new ToolRegistry();
  registry.register({ name: "create_event", schema: CreateEventArgsSchema, handler: createEventHandler(repository) });
  registry.register({ name: "query_events", schema: QueryEventsArgsSchema, handler: queryEventsHandler(repository) });
  registry.register({ name: "delete_event", schema: DeleteEventArgsSchema, handler: deleteEventHandler(repository) });
  const executor = new ToolExecutor(registry);
  executor.registerBeforeExecuteHook(new WriteActionPreviewHook(repository));
  const orchestrator = new QueuedOrchestrator(results);
  return {
    executor,
    orchestrator,
    repository,
    runner: new AgentRunner(orchestrator, executor),
  };
}

test("runs read-only tools on the server until the agent finishes", async () => {
  const existingEvent: CalendarEvent = {
    id: "event-1",
    title: "Project review",
    startAt: "2026-05-30T10:00:00+08:00",
    endAt: "2026-05-30T11:00:00+08:00",
    source: "manual",
    createdAt: "2026-05-29T20:00:00+08:00",
    updatedAt: "2026-05-29T20:00:00+08:00",
  };
  const { orchestrator, runner } = createRunner(
    new MemoryCalendarRepository([existingEvent]),
    [
      {
        kind: "tool_call",
        tool: "query_events",
        arguments: {
          rangeStartAt: "2026-05-30T00:00:00+08:00",
          rangeEndAt: "2026-05-31T00:00:00+08:00",
        },
      },
      { kind: "message", content: "查询完成，今天有一个日程。" },
    ],
  );

  const result = await runner.runUserMessage(
    makeUserMessage("今天有什么安排"),
    context,
  );

  assert.deepEqual(orchestrator.receivedTexts, ["", ""]);
  assert.equal(result.pendingAction, undefined);
  assert.equal(result.messages.at(-1)?.kind, "assistant");
  assert.equal(
    result.messages.some(
      (message) =>
        message.kind === "tool" &&
        message.toolName === "query_events" &&
        Array.isArray((message.data as { events?: unknown[] }).events),
    ),
    true,
  );
});

test("pauses a write tool as a pending action", async () => {
  const { runner, repository } = createRunner(
    new MemoryCalendarRepository(),
    [
      {
        kind: "tool_call",
        tool: "create_event",
        arguments: {
          title: "项目讨论",
          startAt: "2026-05-30T15:00:00+08:00",
          endAt: "2026-05-30T16:00:00+08:00",
        },
      },
    ],
  );

  const result = await runner.runUserMessage(
    makeUserMessage("今天下午三点到四点项目讨论"),
    context,
  );

  assert.equal(result.pendingAction?.type, "create_event");
  assert.deepEqual(await repository.list(), []);
});

test("resumes the server loop after a pending action is confirmed", async () => {
  const { runner, repository } = createRunner(
    new MemoryCalendarRepository(),
    [
      {
        kind: "tool_call",
        tool: "create_event",
        arguments: {
          title: "项目讨论",
          startAt: "2026-05-30T15:00:00+08:00",
          endAt: "2026-05-30T16:00:00+08:00",
        },
      },
      { kind: "message", content: "已创建日程。" },
    ],
  );

  const pendingResult = await runner.runUserMessage(
    makeUserMessage("今天下午三点到四点项目讨论"),
    context,
  );
  const result = await runner.confirmPendingAction(
    pendingResult.pendingAction!.id,
    context,
    pendingResult.messages,
  );

  assert.equal(result.pendingAction, undefined);
  assert.equal((await repository.list()).length, 1);
  assert.equal(result.eventsChanged, true);
  assert.equal(result.messages.at(-1)?.kind, "assistant");
});

test("returns an error message when the loop exceeds its iteration limit", async () => {
  const { executor, orchestrator } = createRunner(
    new MemoryCalendarRepository(),
    Array.from({ length: 3 }, () => ({
      kind: "tool_call" as const,
      tool: "query_events",
      arguments: {
        rangeStartAt: "2026-05-30T00:00:00+08:00",
        rangeEndAt: "2026-05-31T00:00:00+08:00",
      },
    })),
  );

  const result = await new AgentRunner(
    orchestrator,
    executor,
    2,
  ).runUserMessage(makeUserMessage("循环查询"), context);

  assert.equal(result.messages.at(-1)?.kind, "assistant");
  assert.match(
    (result.messages.at(-1) as { content: string }).content,
    /执行步骤过多/,
  );
});
