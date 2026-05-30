import type { CalendarRepository } from "../domain/calendarRepository";
import type { ToolRegistry } from "../domain/toolRegistry";
import type { ToolExecutionResult } from "../domain/toolExecutionResult";
import type { CalendarEvent } from "../domain/calendarTypes";
import type {
  BeforeToolExecuteHook,
  ToolExecutionContext,
} from "../domain/beforeToolExecuteHook";
import type { PendingAction } from "../domain/pendingAction";

export class ToolExecutor {
  private readonly beforeHooks: BeforeToolExecuteHook[] = [];
  private readonly pendingActions = new Map<string, PendingAction>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly repository: CalendarRepository,
  ) {}

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

  private formatMessage(tool: string, data: unknown): string {
    if (!data || typeof data !== "object") return "执行成功";

    const obj = data as Record<string, unknown>;

    switch (tool) {
      case "create_event": {
        const event = obj.event as Record<string, unknown> | undefined;
        const title = event?.title ?? "(无标题)";
        const startAt = event?.startAt
          ? formatLocalTime(event.startAt as string)
          : "";
        const endAt = event?.endAt
          ? formatLocalTime(event.endAt as string)
          : "";
        const timeRange = endAt ? `${startAt}-${endAt}` : startAt;
        return `已创建日程：${title}（${timeRange}）`;
      }

      case "query_events": {
        const events = obj.events as CalendarEvent[] | undefined;
        if (!events || events.length === 0) return "该时间段暂无安排";
        if (events.length === 1) {
          return `找到 1 个日程：\n${formatEvent(events[0])}`;
        }
        return `找到 ${events.length} 个日程：\n${events
          .map((e) => `  · ${formatEvent(e)}`)
          .join("\n")}`;
      }

      case "delete_event": {
        const deleted = (obj.deleted as number) ?? 0;
        const failed = (obj.failed as number) ?? 0;
        let msg = `已删除 ${deleted} 个日程`;
        if (failed > 0) msg += `，${failed} 个删除失败`;
        return msg;
      }

      default:
        return "执行成功";
    }
  }
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hour}:${min}`;
}

function formatEvent(e: CalendarEvent): string {
  const start = formatLocalTime(e.startAt);
  const end = formatLocalTime(e.endAt);
  const location = e.location ? ` @${e.location}` : "";
  return `[${e.id}] ${e.title}  ${start} - ${end}${location}`;
}
