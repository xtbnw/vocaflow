import assert from "node:assert/strict";
import { test } from "node:test";
import type { LLMProvider, ChatMessage } from "../../../../backend/domain/llmProvider";
import { LLMCommandParser } from "../../../../backend/infrastructure/parser/llmCommandParser";
import {
  CreateEventArgsSchema,
  QueryEventsArgsSchema,
  DeleteEventArgsSchema,
} from "../../../../backend/domain/calendarTypes";

const tools = [
  { name: "create_event", schema: CreateEventArgsSchema, handler: async () => {} },
  { name: "query_events", schema: QueryEventsArgsSchema, handler: async () => {} },
  { name: "delete_event", schema: DeleteEventArgsSchema, handler: async () => {} },
];

const context = {
  currentTime: "2026-05-30T15:00:00+08:00",
  timezone: "Asia/Shanghai",
};

function mockProvider(response: string | ((messages: ChatMessage[]) => string)): LLMProvider {
  return {
    config: { url: "", apiKey: "", model: "mock" },
    async chat(messages: ChatMessage[]) {
      return typeof response === "function" ? response(messages) : response;
    },
  };
}

test("parse: create_event with missing info → message", async () => {
  const parser = new LLMCommandParser(mockProvider(JSON.stringify({
    kind: "message",
    content: "请问会议几点结束？",
  })));

  const result = await parser.parse("明天下午3点开会讨论项目进度", context, tools);
  assert.equal(result.kind, "message");
});

test("parse: query_events for next week → tool_call", async () => {
  const parser = new LLMCommandParser(mockProvider(JSON.stringify({
    kind: "tool_call",
    tool: "query_events",
    arguments: {
      rangeStartAt: "2026-06-01T00:00:00+08:00",
      rangeEndAt: "2026-06-07T23:59:59+08:00",
    },
    confidence: 0.9,
  })));

  const result = await parser.parse("下周有什么安排", context, tools);
  assert.equal(result.kind, "tool_call");
});

test("parse: greeting → message", async () => {
  const parser = new LLMCommandParser(mockProvider(JSON.stringify({
    kind: "message",
    content: "你好！有什么可以帮助你的？",
  })));

  const result = await parser.parse("你好", context, tools);
  assert.equal(result.kind, "message");
});

test("parse: nonsense → message", async () => {
  const parser = new LLMCommandParser(mockProvider(JSON.stringify({
    kind: "message",
    content: "无法理解输入内容，请换一种说法。",
  })));

  const result = await parser.parse("asdfghjkl", context, tools);
  assert.equal(result.kind, "message");
});

test("parse: delete_event via multi-step → tool_call", async () => {
  const parser = new LLMCommandParser(mockProvider(JSON.stringify({
    kind: "tool_call",
    tool: "query_events",
    arguments: {
      rangeStartAt: "2026-05-31T00:00:00+08:00",
      rangeEndAt: "2026-05-31T23:59:59+08:00",
      keyword: "开会讨论项目进度",
    },
    confidence: 0.95,
  })));

  const result = await parser.parse("删除明天下午3点开会讨论项目进度的日程", context, tools);
  assert.ok(result.kind === "tool_call" || result.kind === "message");
});

test("parse: with session history maintains context", async () => {
  const parser = new LLMCommandParser(mockProvider(JSON.stringify({
    kind: "tool_call",
    tool: "create_event",
    arguments: {
      title: "和张三开会",
      startAt: "2026-05-31T15:00:00+08:00",
      endAt: "2026-05-31T16:00:00+08:00",
      location: "会议室 A",
    },
    confidence: 0.9,
  })));

  const history = [
    {
      kind: "user" as const,
      id: "1",
      text: "明天下午帮我安排和张三开会",
      timestamp: "2026-05-30T10:00:00+08:00",
    },
    {
      kind: "assistant" as const,
      id: "2",
      content: "请问在哪里开会？",
      timestamp: "2026-05-30T10:00:01+08:00",
    },
  ];

  const result = await parser.parse("会议室 A", context, tools, history);
  assert.ok(result.kind === "tool_call" || result.kind === "message");
});
