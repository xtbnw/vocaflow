import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { AgentRunner } from "../app/agentRunner";
import { CommandOrchestrator } from "../app/commandOrchestrator";
import { ToolExecutor } from "../app/toolExecutor";
import { WriteActionPreviewHook } from "../app/writeActionPreviewHook";
import { ToolRegistry } from "../domain/toolRegistry";
import {
  CreateEventArgsSchema,
  DeleteEventArgsSchema,
  QueryEventsArgsSchema,
} from "../domain/calendarTypes";
import {
  createEventHandler,
  queryEventsHandler,
  deleteEventHandler,
} from "../app/calendarToolHandlers";
import { getLLMProvider } from "../infrastructure/llm/llmProviderFactory";
import { LLMCommandParser } from "../infrastructure/parser/llmCommandParser";
import { SQLiteCalendarRepository } from "../infrastructure/persistence/sqliteCalendarRepository";

function getDatabasePath(): string {
  return (
    process.env.VOCAFLOW_SQLITE_PATH ??
    join(process.cwd(), "data", "vocaflow.sqlite")
  );
}

let _agentRunner: AgentRunner | undefined;
let _calendarRepository: SQLiteCalendarRepository | undefined;
let _toolExecutor: ToolExecutor | undefined;

function init() {
  if (_agentRunner && _calendarRepository) {
    return;
  }

  const databasePath = getDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });

  const repository = new SQLiteCalendarRepository(databasePath);
  _calendarRepository = repository;

  const registry = new ToolRegistry();
  registry.register({ name: "create_event", schema: CreateEventArgsSchema, handler: createEventHandler(repository) });
  registry.register({ name: "query_events", schema: QueryEventsArgsSchema, handler: queryEventsHandler(repository) });
  registry.register({ name: "delete_event", schema: DeleteEventArgsSchema, handler: deleteEventHandler(repository) });

  const executor = new ToolExecutor(registry);
  _toolExecutor = executor;
  executor.registerBeforeExecuteHook(new WriteActionPreviewHook(repository));

  const llm = getLLMProvider();
  const parser = new LLMCommandParser(llm);
  const orchestrator = new CommandOrchestrator(llm, parser, registry);

  _agentRunner = new AgentRunner(orchestrator, executor);
}

function getAgentRunner(): AgentRunner {
  init();
  return _agentRunner!;
}

function getCalendarRepository(): SQLiteCalendarRepository {
  init();
  return _calendarRepository!;
}

export const serverAgentRunner = {
  runUserMessage(
    userMessage: Parameters<AgentRunner["runUserMessage"]>[0],
    context: Parameters<AgentRunner["runUserMessage"]>[1],
    history?: Parameters<AgentRunner["runUserMessage"]>[2],
  ) {
    return getAgentRunner().runUserMessage(userMessage, context, history);
  },
  confirmPendingAction(
    pendingActionId: string,
    context: Parameters<AgentRunner["confirmPendingAction"]>[1],
    history: Parameters<AgentRunner["confirmPendingAction"]>[2],
  ) {
    return getAgentRunner().confirmPendingAction(pendingActionId, context, history);
  },
  cancelPendingAction(
    pendingActionId: string,
    history: Parameters<AgentRunner["cancelPendingAction"]>[1],
  ) {
    return getAgentRunner().cancelPendingAction(pendingActionId, history);
  },
  removePendingAction(pendingActionId: string) {
    init();
    _toolExecutor!.removePendingAction(pendingActionId);
  },
};

export const serverCalendarRepository = {
  async list() {
    return getCalendarRepository().list();
  },
};
