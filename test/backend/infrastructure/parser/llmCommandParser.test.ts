import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import type { LLMProvider } from "../../../../backend/domain/llmProvider";
import { DeepSeekProvider } from "../../../../backend/infrastructure/llm/deepseekProvider";
import { LLMCommandParser } from "../../../../backend/infrastructure/parser/llmCommandParser";
import {
  CreateEventArgsSchema,
  QueryEventsArgsSchema,
  FindEventsForDeleteArgsSchema,
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
  { name: "find_events_for_delete", schema: FindEventsForDeleteArgsSchema, handler: async () => {} },
];

const context = {
  currentTime: "2026-05-30T15:00:00+08:00",
  timezone: "Asia/Shanghai",
};

function makeProvider(): LLMProvider {
  if (process.env.DEEPSEEK_API_KEY) {
    return DeepSeekProvider.fromEnv();
  }
  // fallback: mock 用于无 API key 时
  return {
    config: { url: "", apiKey: "", model: "mock" },
    async chat(prompt: string) {
      const toolDefs = tools.map((t) => `${t.name}: {${Object.keys((t.schema as any).shape).join(", ")}}`).join("; ");
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

test("parse: find_events_for_delete → tool_call or clarification", async () => {
  const llm = makeProvider();
  const parser = new LLMCommandParser(llm);

  const result = await parser.parse("删除明天下午3点开会讨论项目进度的日程", context, tools);

  console.log(JSON.stringify(result, null, 2));

  // 至少不能是 unknown
  assert.notEqual(result.kind, "unknown");
});
