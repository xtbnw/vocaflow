import type { CalendarRepository } from "../domain/calendarRepository";
import type { ToolRegistry } from "../domain/toolRegistry";
import type { ToolExecutionResult } from "../domain/toolExecutionResult";
import type { CalendarEvent } from "../domain/calendarTypes";

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly repository: CalendarRepository,
  ) {}

  async execute(tool: string, args: unknown): Promise<ToolExecutionResult> {
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
        return `找到 ${events.length} 个日程：\n${events.map((e) => `  · ${formatEvent(e)}`).join("\n")}`;
      }

      case "find_events_for_delete": {
        const events = obj.events as CalendarEvent[] | undefined;
        if (!events || events.length === 0) return "未找到相关日程";
        if (events.length === 1) {
          return `找到 1 个候选日程：\n${formatEvent(events[0])}`;
        }
        return `找到 ${events.length} 个候选日程：\n${events.map((e) => `  · ${formatEvent(e)}`).join("\n")}`;
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
  return `${e.title}  ${start} - ${end}${location}`;
}
