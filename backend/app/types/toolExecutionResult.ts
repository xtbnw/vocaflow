import type { PendingAction } from "./pendingAction";

export type ToolExecutionResult =
  | {
      kind: "execution";
      success: boolean;
      tool: string;
      message: string;
      data?: unknown;
    }
  | {
      kind: "pending_action";
      success: true;
      tool: string;
      message: string;
      pendingAction: PendingAction;
    };
