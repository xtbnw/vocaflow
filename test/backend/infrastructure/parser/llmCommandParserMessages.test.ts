import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMessages } from "../../../../backend/infrastructure/parser/llmCommandParser";
import { QueryEventsArgsSchema } from "../../../../backend/domain/calendarTypes";

const context = {
  currentTime: "2026-05-30T12:00:00+08:00",
  timezone: "Asia/Shanghai",
};

const tools = [
  {
    name: "query_events",
    schema: QueryEventsArgsSchema,
    handler: async () => {},
  },
];

test("continues from structured tool history without appending a control message", () => {
  const messages = buildMessages("", context, tools, [
    {
      kind: "user",
      id: "user-1",
      text: "删除今天的全部会议",
      timestamp: "2026-05-30T12:00:00+08:00",
    },
    {
      kind: "tool",
      id: "tool-1",
      toolName: "query_events",
      arguments: {
        rangeStartAt: "2026-05-30T00:00:00+08:00",
        rangeEndAt: "2026-05-31T00:00:00+08:00",
      },
      success: true,
      message: "找到 1 个日程",
      data: {
        events: [{ id: "event-1", title: "项目会议" }],
      },
      timestamp: "2026-05-30T12:00:01+08:00",
    },
  ]);

  assert.equal(messages.at(-1)?.content.includes('"id":"event-1"'), true);
  assert.equal(messages.some((message) => message.content === "请继续"), false);
  assert.equal(messages.length, 3);
});
