import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { DeepAgentsRuntime } from "../infrastructure/agent/deepAgentsRuntime";
import { SQLiteCalendarRepository } from "../infrastructure/persistence/sqliteCalendarRepository";
import type { AgentRuntime } from "../domain/agentRuntime";

function getDatabasePath(): string {
  return (
    process.env.VOCAFLOW_SQLITE_PATH ??
    join(process.cwd(), "data", "vocaflow.sqlite")
  );
}

let _runtime: AgentRuntime | undefined;

function getRuntime(): AgentRuntime {
  if (!_runtime) {
    const dbPath = getDatabasePath();
    mkdirSync(dirname(dbPath), { recursive: true });
    const repository = new SQLiteCalendarRepository(dbPath);
    _runtime = new DeepAgentsRuntime(repository);
  }
  return _runtime;
}

/** Deep Agents 旁路运行时的懒加载单例，供 SSE 路由使用。 */
export const serverDeepAgentsRuntime = {
  stream(message: string, threadId: string, signal?: AbortSignal) {
    return getRuntime().stream(message, threadId, signal);
  },
};

/** @internal 测试用：替换运行时实例。 */
export function __overrideRuntimeForTest(runtime: AgentRuntime) {
  _runtime = runtime;
}
