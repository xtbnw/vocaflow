/**
 * 集成测试辅助工具：fixture 创建、流收集（含超时）、API Key 检查。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

import {
  DeepAgentsRuntime,
  classifyStreamError,
} from "../../backend/infrastructure/agent/deepAgentsRuntime";
import type { CalendarRepository } from "../../backend/domain/calendarRepository";
import type { CalendarEvent } from "../../backend/domain/calendarTypes";
import type { AgentStreamEvent } from "../../backend/domain/agentRuntime";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export interface TempFixture {
  repo: CalendarRepository;
  saved: CalendarEvent[];
  deleted: string[];
  checkpointer: SqliteSaver;
  db: Database.Database;
  dir: string;
}

export function createTempFixture(): TempFixture {
  const dir = mkdtempSync(join(tmpdir(), "vocaflow-int-"));
  const dbPath = join(dir, "checkpoints.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode=WAL");
  const checkpointer = new SqliteSaver(db);

  const saved: CalendarEvent[] = [];
  const deleted: string[] = [];

  const repo: CalendarRepository = {
    list: async () => [...saved],
    save: async (e) => {
      const event = e as CalendarEvent;
      saved.push(event);
      return event;
    },
    update: async (e) => e,
    delete: async (id) => {
      deleted.push(id as string);
    },
  };

  return { repo, saved, deleted, checkpointer, db, dir };
}

export function cleanupFixture(f: TempFixture) {
  try { f.db.close(); } catch { /* ignore */ }
  try { rmSync(f.dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Collect result
// ---------------------------------------------------------------------------

export interface CollectResult {
  events: AgentStreamEvent[];
  hasError: boolean;
  errorCode?: string;
  errorMessage?: string;
  hasInterrupt: boolean;
  interruptAction?: string;
  hasDone: boolean;
  messages: string[];
  fullText: string;
  toolsStarted: string[];
  toolsFinished: string[];
}

const DEFAULT_TIMEOUT_MS = 30000;

/** Timeout 触发后若无 done/interrupt/error，补 NETWORK_ERROR 避免静默丢失。 */
export function ensureTimeoutError(
  events: AgentStreamEvent[],
  timedOut: boolean,
  timeoutMs: number,
): AgentStreamEvent[] {
  if (!timedOut) return events;
  const hasTerminal = events.some(
    (e) => e.type === "done" || e.type === "interrupt" || e.type === "error",
  );
  if (hasTerminal) return events;
  return [
    ...events,
    {
      type: "error" as const,
      code: "NETWORK_ERROR",
      message: `LLM request timed out after ${timeoutMs}ms`,
    },
  ];
}

/** 收集流中所有事件，超时后 abort 并记录 NETWORK_ERROR。 */
export async function collectStream(
  runtime: DeepAgentsRuntime,
  message: string,
  threadId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CollectResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let events: AgentStreamEvent[];
  try {
    events = await collectEvents(() => runtime.stream(message, threadId, controller.signal));
  } finally {
    clearTimeout(timer);
  }

  return analyzeEvents(ensureTimeoutError(events, timedOut, timeoutMs));
}

/** 将 resume 返回的迭代器完整收集为事件列表，超时后 abort 并记录 NETWORK_ERROR。 */
export async function collectResume(
  runtime: DeepAgentsRuntime,
  decision: "approve" | "reject",
  threadId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AgentStreamEvent[]> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const events = await collectEvents(() => runtime.resume({ decision }, threadId, controller.signal));
    return ensureTimeoutError(events, timedOut, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

async function collectEvents(
  factory: () => AsyncIterable<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  try {
    for await (const ev of factory()) {
      events.push(ev);
    }
  } catch (err) {
    events.push({
      type: "error",
      code: classifyStreamError(err),
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return events;
}

function analyzeEvents(events: AgentStreamEvent[]): CollectResult {
  const messages: string[] = [];
  const toolsStarted: string[] = [];
  const toolsFinished: string[] = [];
  let hasError = false;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  let hasInterrupt = false;
  let interruptAction: string | undefined;
  let hasDone = false;

  for (const ev of events) {
    switch (ev.type) {
      case "message_delta":
        messages.push(ev.text);
        break;
      case "tool_started":
        toolsStarted.push(ev.tool);
        break;
      case "tool_finished":
        toolsFinished.push(ev.tool);
        break;
      case "error":
        hasError = true;
        errorCode = ev.code;
        errorMessage = ev.message;
        break;
      case "interrupt":
        hasInterrupt = true;
        interruptAction = ev.review.action;
        break;
      case "done":
        hasDone = true;
        break;
    }
  }

  return {
    events,
    hasError,
    errorCode,
    errorMessage,
    hasInterrupt,
    interruptAction,
    hasDone,
    messages,
    fullText: messages.join(""),
    toolsStarted,
    toolsFinished,
  };
}

// ---------------------------------------------------------------------------
// Delete repo factory
// ---------------------------------------------------------------------------

export function makeDeleteRepo(existingEvent: CalendarEvent, deleted: string[]): CalendarRepository {
  return {
    list: async () => [existingEvent],
    save: async (e) => e as CalendarEvent,
    update: async (e) => e as CalendarEvent,
    delete: async (id) => {
      deleted.push(id as string);
    },
  };
}

// ---------------------------------------------------------------------------
// API Key check
// ---------------------------------------------------------------------------

export function requireApiKey(t: { skip: (reason: string) => void }): boolean {
  if (!process.env.DEEPSEEK_API_KEY) {
    t.skip("缺少 DEEPSEEK_API_KEY，跳过真实 LLM 测试");
    return false;
  }
  return true;
}
