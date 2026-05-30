import type { ToolExecutionResult } from "./toolExecutionResult";

export interface ToolExecutionContext {
  toolName: string;
  args: unknown;
  commandId?: string;
  source?: "normal" | "pending_action_confirmed";
}

export type ToolExecutionDecision =
  | { kind: "continue" }
  | { kind: "intercept"; result: ToolExecutionResult }
  | { kind: "reject"; message: string };

export interface BeforeToolExecuteHook {
  name: string;
  run(context: ToolExecutionContext): Promise<ToolExecutionDecision>;
}
