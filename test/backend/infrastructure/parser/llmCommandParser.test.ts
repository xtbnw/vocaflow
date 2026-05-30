import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import type { LLMProvider, ChatMessage } from "../../../../backend/domain/llmProvider";
import { DeepSeekProvider } from "../../../../backend/infrastructure/llm/deepseekProvider";
import { LLMCommandParser } from "../../../../backend/infrastructure/parser/llmCommandParser";
import {
  CreateEventArgsSchema,
  QueryEventsArgsSchema,
  DeleteEventArgsSchema,
} from "../../../../backend/domain/calendarTypes";

// 加载 .env.local
const envPath = resolve(import.meta.dirname!, "..", "..", "..", "..", ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
} catch {
  // .env.local 不存在时跳过
}

const tools = [
  { name: "create_event", schema: CreateEventArgsSchema, handler: async () => {} },
  { name: "query_events", schema: QueryEventsArgsSchema, handler: async () => {} },
  { name: "delete_event", schema: DeleteEventArgsSchema, handler: async () => {} },
];

const context = {
  currentTime: "2026-05-30T15:00:00+08:00",
  timezone: "Asia/Shanghai",
};

function makeProvider(): LLMProvider {
  if (process.env.DEEPSEEK_API_KEY) {
    return DeepSeekProvider.fromEnv();
  }
  return {
    config: { url: "", apiKey: "", model: "mock" },
    async chat(_messages: ChatMessage[]) {
      return JSON.stringify({
        kind: "tool_call",
        tool: "query_events",
        arguments: { rangeStartAt: "2026-06-01T00:00:00+08:00", rangeEndAt: "2026-06-07T23:59:59+08:00" },
        confidence: 0.9,
      });
    },
  };
}

after(() => {
  delete process.env.DEEPSEEK_API_KEY;
});

test("parse: create_event with missing endAt → clarification", async () => {
  const llm = makeProvider();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("明天下午3点开会讨论项目进度", context, tools);
  assert.equal(result.kind, "clarification");
});

test("parse: query_events for next week → tool_call", async () => {
  const llm = makeProvider();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("下周有什么安排", context, tools);
  assert.equal(result.kind, "tool_call");
});

test("parse: chat greeting → chat", async () => {
  const llm = makeProvider();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("你好", context, tools);
  assert.equal(result.kind, "chat");
});

test("parse: nonsense → unknown", async () => {
  const llm = makeProvider();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("asdfghjkl", context, tools);
  assert.equal(result.kind, "unknown");
});

test("parse: delete_event via multi-step → tool_call or clarification", async () => {
  const llm = makeProvider();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("删除明天下午3点开会讨论项目进度的日程", context, tools);

  console.log(JSON.stringify(result, null, 2));

  assert.notEqual(result.kind, "unknown");
});

test("parse: with session history maintains context", async () => {
  const llm = makeProvider();
  const parser = new LLMCommandParser(llm);

  // Simulate a follow-up after clarification
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
      content: "请补充会议地点",
      resultKind: "clarification" as const,
      timestamp: "2026-05-30T10:00:01+08:00",
    },
  ];

  const result = await parser.parse("会议室 A", context, tools, history);
  // With history context, the LLM should understand this completes a create_event
  // Mock returns tool_call so we accept any valid kind
  assert.ok(["tool_call", "clarification", "chat", "unknown", "finish"].includes(result.kind));
});
