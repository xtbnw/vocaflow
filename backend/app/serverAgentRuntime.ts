import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { AgentRunner } from "./agentRunner";
import { CommandOrchestrator } from "./commandOrchestrator";
import { ToolExecutor } from "./toolExecutor";
import { WriteActionPreviewHook } from "./writeActionPreviewHook";
import { createDefaultToolRegistry } from "../domain/toolRegistry";
import { getLLMProvider } from "../infrastructure/llm/llmProviderFactory";
import { LLMCommandParser } from "../infrastructure/parser/llmCommandParser";
import { SQLiteCalendarRepository } from "../infrastructure/persistence/sqliteCalendarRepository";

const databasePath =
  process.env.VOCAFLOW_SQLITE_PATH ??
  join(process.cwd(), "data", "vocaflow.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });

const repository = new SQLiteCalendarRepository(databasePath);
const registry = createDefaultToolRegistry(repository);
const executor = new ToolExecutor(registry);
executor.registerBeforeExecuteHook(new WriteActionPreviewHook(repository));

const llm = getLLMProvider();
const parser = new LLMCommandParser(llm);
const orchestrator = new CommandOrchestrator(llm, parser, registry);

export const serverAgentRunner = new AgentRunner(orchestrator, executor);
export const serverCalendarRepository = repository;
