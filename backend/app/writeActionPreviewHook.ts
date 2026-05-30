import type {
  BeforeToolExecuteHook,
  ToolExecutionContext,
  ToolExecutionDecision,
} from "../domain/beforeToolExecuteHook";
import type { CalendarRepository } from "../domain/calendarRepository";
import type { CalendarEvent } from "../domain/calendarTypes";
import type { PendingAction, ActionPreview } from "./types/pendingAction";
import {
  newId,
  defaultEndAt,
  formatLocalTime,
  formatTimeRange,
  toTimestamp,
} from "../shared/timeUtils";

const WRITE_TOOLS = new Set(["create_event", "delete_event"]);

async function buildCreateEventPreview(
  args: Record<string, unknown>,
  repository: CalendarRepository,
): Promise<ActionPreview> {
  const items: ActionPreview["items"] = [
    { label: "标题", value: String(args.title ?? "") },
    {
      label: "开始时间",
      value: args.startAt ? formatLocalTime(args.startAt as string) : "未指定",
    },
    {
      label: "结束时间",
      value: args.endAt ? formatLocalTime(args.endAt as string) : "未指定",
    },
    { label: "地点", value: String(args.location ?? "未指定") },
    { label: "备注", value: String(args.notes ?? "无") },
  ];

  const warnings: string[] = [];
  if (!args.endAt) {
    warnings.push("未指定结束时间，将默认设置为开始时间后 1 小时");
  }
  if (!args.title || String(args.title).trim().length === 0) {
    warnings.push("日程标题为空");
  }

  const startAt = String(args.startAt ?? "");
  if (startAt) {
    const endAt = args.endAt ? String(args.endAt) : defaultEndAt(startAt);
    const startTime = new Date(startAt).getTime();
    const endTime = new Date(endAt).getTime();
    const existingEvents = await repository.list();
    const conflicts = existingEvents.filter(
      (event) =>
        toTimestamp(event.startAt) < endTime &&
        toTimestamp(event.endAt) > startTime,
    );
    warnings.push(
      ...conflicts.map(
        (event) =>
          `时间冲突：${formatTimeRange(event.startAt, event.endAt)} 已有"${event.title}"`,
      ),
    );
  }

  return {
    title: "创建日程",
    summary: "将在日历中创建以下日程",
    items,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function buildDeleteEventPreview(
  args: Record<string, unknown>,
): ActionPreview {
  const eventIds = (Array.isArray(args.eventIds) ? args.eventIds : []) as string[];
  return {
    title: "删除日程",
    summary: `将删除 ${eventIds.length} 个日程`,
    items: [{ label: "日程数量", value: `${eventIds.length} 个日程` }],
    warnings: ["该操作会永久删除日程，不可撤销"],
  };
}

export class WriteActionPreviewHook implements BeforeToolExecuteHook {
  name = "WriteActionPreviewHook";

  constructor(private readonly repository: CalendarRepository) {}

  async run(context: ToolExecutionContext): Promise<ToolExecutionDecision> {
    if (context.source === "pending_action_confirmed") {
      return { kind: "continue" };
    }

    if (!WRITE_TOOLS.has(context.toolName)) {
      return { kind: "continue" };
    }

    const args = (context.args ?? {}) as Record<string, unknown>;

    let actionType: PendingAction["type"];
    let preview: ActionPreview;

    switch (context.toolName) {
      case "create_event": {
        actionType = "create_event";
        try {
          preview = await buildCreateEventPreview(args, this.repository);
        } catch {
          return { kind: "reject", message: "无法读取已有日程，请稍后重试" };
        }
        break;
      }
      case "delete_event": {
        actionType = "delete_event";
        preview = buildDeleteEventPreview(args);
        break;
      }
      default:
        return { kind: "continue" };
    }

    const pendingAction: PendingAction = {
      id: newId(),
      type: actionType,
      status: "pending",
      preview,
      payload: args,
      createdAt: new Date().toISOString(),
    };

    return {
      kind: "intercept",
      result: {
        kind: "pending_action",
        success: true,
        tool: context.toolName,
        message: "请确认后执行",
        pendingAction,
      },
    };
  }
}
