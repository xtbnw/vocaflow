import type { CalendarEvent } from "../domain/calendarTypes";
import { formatLocalTime } from "../shared/timeUtils";

export function formatToolResult(tool: string, data: unknown): string {
  if (!data || typeof data !== "object") return "执行成功";

  const obj = data as Record<string, unknown>;

  switch (tool) {
    case "create_event": {
      const event = obj.event as Record<string, unknown> | undefined;
      const title = event?.title ?? "(无标题)";
      const startAt = event?.startAt ? formatLocalTime(event.startAt as string) : "";
      const endAt = event?.endAt ? formatLocalTime(event.endAt as string) : "";
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

function formatEvent(e: CalendarEvent): string {
  const start = formatLocalTime(e.startAt);
  const end = formatLocalTime(e.endAt);
  const location = e.location ? ` @${e.location}` : "";
  return `[${e.id}] ${e.title}  ${start} - ${end}${location}`;
}
