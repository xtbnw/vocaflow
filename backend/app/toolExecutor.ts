import type { ToolRegistry } from "../domain/toolRegistry";
import type { ToolExecutionResult } from "./types/toolExecutionResult";
import type {
  BeforeToolExecuteHook,
  ToolExecutionContext,
} from "../domain/beforeToolExecuteHook";
import type { PendingAction } from "./types/pendingAction";
import { formatToolResult } from "./toolResultPresenter";

export class ToolExecutor {
  private readonly beforeHooks: BeforeToolExecuteHook[] = [];
  private readonly pendingActions = new Map<string, PendingAction>();

  constructor(private readonly registry: ToolRegistry) {}

  registerBeforeExecuteHook(hook: BeforeToolExecuteHook): void {
    this.beforeHooks.push(hook);
  }

  async execute(
    tool: string,
    args: unknown,
    source: "normal" | "pending_action_confirmed" = "normal",
  ): Promise<ToolExecutionResult> {
    const context: ToolExecutionContext = { toolName: tool, args, source };

    for (const hook of this.beforeHooks) {
      const decision = await hook.run(context);
      if (decision.kind === "intercept") return decision.result;
      if (decision.kind === "reject") {
        return {
          kind: "execution",
          success: false,
          tool,
          message: decision.message,
        };
      }
    }

    const result = await this.registry.execute({ tool, arguments: args });

    if (!result.success) {
      return {
        kind: "execution",
        success: false,
        tool,
        message: result.error ?? "工具执行失败",
      };
    }

    return {
      kind: "execution",
      success: true,
      tool,
      message: this.formatMessage(tool, result.data),
      data: result.data,
    };
  }

  storePendingAction(pendingAction: PendingAction): void {
    this.pendingActions.set(pendingAction.id, pendingAction);
  }

  getPendingAction(id: string): PendingAction | undefined {
    return this.pendingActions.get(id);
  }

  async executePendingAction(
    pendingActionId: string,
  ): Promise<ToolExecutionResult> {
    const pending = this.pendingActions.get(pendingActionId);
    if (!pending) {
      return {
        kind: "execution",
        success: false,
        tool: "unknown",
        message: "未找到待确认的操作",
      };
    }

    if (pending.status !== "pending") {
      return {
        kind: "execution",
        success: false,
        tool: pending.type,
        message: "该操作已处理，无法重复执行",
      };
    }

    pending.status = "confirmed";

    const result = await this.execute(
      pending.type,
      pending.payload,
      "pending_action_confirmed",
    );

    if (result.kind === "execution") {
      pending.status = result.success ? "executed" : "pending";
    } else {
      pending.status = "pending";
    }

    return result;
  }

  cancelPendingAction(pendingActionId: string): boolean {
    const pending = this.pendingActions.get(pendingActionId);
    if (!pending || pending.status !== "pending") return false;
    pending.status = "cancelled";
    return true;
  }

  removePendingAction(id: string): void {
    this.pendingActions.delete(id);
  }

  private formatMessage(tool: string, data: unknown): string {
    return formatToolResult(tool, data);
  }
}
