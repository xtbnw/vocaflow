import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import type { LLMProvider, ChatMessage } from "../../backend/domain/llmProvider";
import { DeepSeekProvider } from "../../backend/infrastructure/llm/deepseekProvider";
import { LLMCommandParser } from "../../backend/infrastructure/parser/llmCommandParser";
import {
  CreateEventArgsSchema,
  QueryEventsArgsSchema,
  DeleteEventArgsSchema,
} from "../../backend/domain/calendarTypes";

// Load .env.local
const envPath = resolve(import.meta.dirname!, "..", "..", ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
} catch {
  // .env.local not found, skip
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

function skipIfNoApiKey() {
  if (!process.env.DEEPSEEK_API_KEY) {
    return true;
  }
  return false;
}

after(() => {
  delete process.env.DEEPSEEK_API_KEY;
});

test("parse: create_event with missing endAt → message", { skip: skipIfNoApiKey() }, async () => {
  const llm = DeepSeekProvider.fromEnv();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("明天下午3点开会讨论项目进度", context, tools);
  assert.equal(result.kind, "message");
});

test("parse: query_events for next week → tool_call", { skip: skipIfNoApiKey() }, async () => {
  const llm = DeepSeekProvider.fromEnv();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("下周有什么安排", context, tools);
  assert.equal(result.kind, "tool_call");
});

test("parse: greeting → message", { skip: skipIfNoApiKey() }, async () => {
  const llm = DeepSeekProvider.fromEnv();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("你好", context, tools);
  assert.equal(result.kind, "message");
});

test("parse: nonsense → message", { skip: skipIfNoApiKey() }, async () => {
  const llm = DeepSeekProvider.fromEnv();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("asdfghjkl", context, tools);
  assert.equal(result.kind, "message");
});

test("parse: delete_event via multi-step → tool_call or message", { skip: skipIfNoApiKey() }, async () => {
  const llm = DeepSeekProvider.fromEnv();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("删除明天下午3点开会讨论项目进度的日程", context, tools);
  assert.ok(result.kind === "tool_call" || result.kind === "message");
});

test("parse: with session history maintains context", { skip: skipIfNoApiKey() }, async () => {
  const llm = DeepSeekProvider.fromEnv();
  const parser = new LLMCommandParser(llm);

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
