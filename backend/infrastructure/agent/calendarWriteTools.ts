import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import type { CalendarRepository } from "../../domain/calendarRepository";
import {
  CreateEventArgsSchema,
  DeleteEventArgsSchema,
  type CreateEventArgs,
  type DeleteEventArgs,
} from "../../domain/calendarTypes";
import { toTimestamp, defaultEndAt, formatLocalTime, formatTimeRange } from "../../shared/timeUtils";
import { createEventHandler } from "../../app/calendarToolHandlers";
import { deleteEventHandler } from "../../app/calendarToolHandlers";
import type { ActionPreview } from "../../app/types/pendingAction";
import type { ToolReviewInterrupt } from "../../domain/agentRuntime";

// ---------------------------------------------------------------------------
// Preview builders — 计算审批预览信息（冲突检测等）
// ---------------------------------------------------------------------------

export async function buildCreateEventPreview(
  args: CreateEventArgs,
  repository: CalendarRepository,
): Promise<ActionPreview> {
  const items: ActionPreview["items"] = [
    { label: "标题", value: String(args.title ?? "") },
    {
      label: "开始时间",
      value: args.startAt ? formatLocalTime(args.startAt) : "未指定",
    },
    {
      label: "结束时间",
      value: args.endAt ? formatLocalTime(args.endAt) : "未指定",
    },
    { label: "地点", value: String(args.location ?? "未指定") },
    { label: "备注", value: String(args.notes ?? "无") },
    {
      label: "提醒",
      value:
        args.reminderMinutesBefore !== undefined
          ? `提前 ${args.reminderMinutesBefore} 分钟`
          : "未设置",
    },
  ];

  const warnings: string[] = [];
  if (!args.endAt) {
    warnings.push("未指定结束时间，将默认设置为开始时间后 1 小时");
  }
  if (!args.title || args.title.trim().length === 0) {
    warnings.push("日程标题为空");
  }

  if (args.startAt) {
    const endAt = args.endAt ?? defaultEndAt(args.startAt);
    const startTime = new Date(args.startAt).getTime();
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

function buildDeleteEventPreview(args: DeleteEventArgs): ActionPreview {
  const eventIds = args.eventIds;
  return {
    title: "删除日程",
    summary: `将删除 ${eventIds.length} 个日程`,
    items: [{ label: "日程数量", value: `${eventIds.length} 个日程` }],
    warnings: ["该操作会永久删除日程，不可撤销"],
  };
}

// ---------------------------------------------------------------------------
// Interrupt helper
// ---------------------------------------------------------------------------

function doInterrupt(
  action: ToolReviewInterrupt["action"],
  args: Record<string, unknown>,
  preview: ActionPreview,
): { decision: "approve" | "reject" } {
  const payload: ToolReviewInterrupt = {
    kind: "tool_review",
    action,
    arguments: args,
    preview,
  };
  return interrupt(payload);
}

// ---------------------------------------------------------------------------
// Tool factories
// ---------------------------------------------------------------------------

/**
 * 创建 create_event 工具。
 *
 * 执行顺序：
 * 1. Zod 参数校验 (由 LangChain tool schema 完成)
 * 2. 无副作用读取与 ActionPreview 计算
 * 3. interrupt() 返回审核 payload
 * 4. resume 后检查 decision
 * 5. 仅当 decision 为 approve 时执行 SQLite 写入
 */
export function createCreateEventTool(repository: CalendarRepository) {
  return tool(
    async (args: CreateEventArgs) => {
      // Step 2: 无副作用读取与 ActionPreview 计算
      const preview = await buildCreateEventPreview(args, repository);

      // Step 3: interrupt() 返回审核 payload
      const result = doInterrupt("create_event", args as Record<string, unknown>, preview);

      // Step 4: resume 后检查 decision
      if (result.decision !== "approve") {
        return JSON.stringify({ action: "rejected", message: "操作已取消" });
      }

      // Step 5: 仅当 approve 时执行写入，复用 createEventHandler
      const handler = createEventHandler(repository);
      const res = await handler(args);
      return JSON.stringify(res);
    },
    {
      name: "create_event",
      description:
        "在日历中创建新的日程事件。" +
        "当用户要求添加、创建、安排日程、会议、提醒等需要新增日历条目时调用此工具。" +
        "title 为日程标题，startAt 和 endAt 为 ISO 8601 格式的日期时间字符串（含时区），" +
        "分别表示开始和结束时间。location 为可选地点，notes 为可选备注，" +
        "reminderMinutesBefore 为可选提前提醒分钟数。",
      schema: CreateEventArgsSchema,
    },
  );
}

/**
 * 创建 delete_event 工具。
 *
 * 执行顺序同 create_event：
 * 1. Zod 参数校验
 * 2. 无副作用预览计算
 * 3. interrupt() 返回审核 payload
 * 4. resume 后检查 decision
 * 5. 仅当 approve 时执行删除
 */
export function createDeleteEventTool(repository: CalendarRepository) {
  return tool(
    async (args: DeleteEventArgs) => {
      // Step 2: 无副作用预览计算
      const preview = buildDeleteEventPreview(args);

      // Step 3: interrupt() 返回审核 payload
      const result = doInterrupt("delete_event", args as Record<string, unknown>, preview);

      // Step 4: resume 后检查 decision
      if (result.decision !== "approve") {
        return JSON.stringify({ action: "rejected", message: "操作已取消" });
      }

      // Step 5: 仅当 approve 时执行删除，复用 deleteEventHandler
      const handler = deleteEventHandler(repository);
      const res = await handler(args);
      return JSON.stringify(res);
    },
    {
      name: "delete_event",
      description:
        "从日历中删除一个或多个日程事件。" +
        "当用户要求删除、取消、移除日程时调用此工具。" +
        "eventIds 为要删除的日程 ID 列表。" +
        "删除前应先通过 query_events 查询确认目标日程。",
      schema: DeleteEventArgsSchema,
    },
  );
}
