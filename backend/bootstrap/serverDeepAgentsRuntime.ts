import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { DeepAgentsRuntime } from "../infrastructure/agent/deepAgentsRuntime";
import { SQLiteCalendarRepository } from "../infrastructure/persistence/sqliteCalendarRepository";
import type { AgentRuntime, ToolReviewDecision } from "../domain/agentRuntime";
import type { CalendarEvent } from "../domain/calendarTypes";

function getDatabasePath(): string {
  return (
    process.env.VOCAFLOW_SQLITE_PATH ??
    join(process.cwd(), "data", "vocaflow.sqlite")
  );
}

let _runtime: AgentRuntime | undefined;
let _repository: SQLiteCalendarRepository | undefined;

function getRepository(): SQLiteCalendarRepository {
  if (!_repository) {
    const dbPath = getDatabasePath();
    mkdirSync(dirname(dbPath), { recursive: true });
    _repository = new SQLiteCalendarRepository(dbPath);
  }
  return _repository;
}

function getRuntime(): AgentRuntime {
  if (!_runtime) {
    _runtime = new DeepAgentsRuntime(getRepository());
  }
  return _runtime;
}

export const serverDeepAgentsRuntime = {
  stream(message: string, threadId: string, signal?: AbortSignal) {
    return getRuntime().stream(message, threadId, signal);
  },
  resume(decision: ToolReviewDecision, threadId: string, signal?: AbortSignal) {
    return getRuntime().resume(decision, threadId, signal);
  },
  async deleteThread(threadId: string) {
    return getRuntime().deleteThread(threadId);
  },
  async list(): Promise<CalendarEvent[]> {
    return getRepository().list();
  },
  async claimDueReminders(now: string): Promise<CalendarEvent[]> {
    return getRepository().claimDueReminders(now);
  },
};

/** @internal 测试用：替换运行时实例。 */
export function __overrideRuntimeForTest(runtime: AgentRuntime) {
  _runtime = runtime;
}

/** @internal 测试用：替换 repository 实例（不影响 runtime）。 */
export function __overrideRepositoryForTest(repository: SQLiteCalendarRepository) {
  _repository = repository;
}

/** @internal 测试用：重置所有单例状态。 */
export function __resetForTest() {
  _runtime = undefined;
  _repository = undefined;
}
