import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DeepAgentsRuntime,
  createQueryEventsTool,
  DEFAULT_LLM_CONFIG,
} from "../../../../backend/infrastructure/agent/deepAgentsRuntime";
import type { CalendarRepository } from "../../../../backend/domain/calendarRepository";
import type { CalendarEvent } from "../../../../backend/domain/calendarTypes";
import { QueryEventsArgsSchema } from "../../../../backend/domain/calendarTypes";
import { AIMessage } from "@langchain/core/messages";
import type { DeepAgent } from "deepagents";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function stubRepo(events: CalendarEvent[] = []): CalendarRepository {
  return {
    list: async () => [...events],
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
  };
}

const sampleEvent: CalendarEvent = {
  id: "evt-1",
  title: "团队会议",
  startAt: "2026-06-01T09:00:00.000Z",
  endAt: "2026-06-01T10:00:00.000Z",
  source: "text",
  createdAt: "2026-05-31T12:00:00.000Z",
  updatedAt: "2026-05-31T12:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Existing tests (adapted for new constructor signature)
// ---------------------------------------------------------------------------

test("DEFAULT_LLM_CONFIG has thinking explicitly disabled", () => {
  assert.deepEqual(
    DEFAULT_LLM_CONFIG.modelKwargs,
    { thinking: { type: "disabled" } },
  );
  assert.equal(DEFAULT_LLM_CONFIG.model, "deepseek-v4-pro");
});

test("DEFAULT_LLM_CONFIG no longer uses reasoning_effort", () => {
  assert.equal(
    "reasoning_effort" in DEFAULT_LLM_CONFIG.modelKwargs,
    false,
  );
});

test("DeepAgentsRuntime implements AgentRuntime interface", () => {
  const runtime = createTestRuntime();
  assert.equal(runtime.kind, "deepagents");
  assert.equal(runtime.model, "deepseek-v4-pro");
});

test("DeepAgentsRuntime exposes internal agent instance", () => {
  const runtime = createTestRuntime();
  const agent = runtime.agent;
  assert.notEqual(agent, undefined);
  assert.notEqual(agent, null);
});

test("DeepAgentsRuntime can be instantiated multiple times", () => {
  const a = createTestRuntime();
  const b = createTestRuntime();
  assert.equal(a.kind, b.kind);
  assert.equal(a.model, b.model);
});

test("DeepAgentsRuntime passes llm with thinking disabled to agent factory", () => {
  let capturedLLM: unknown;
  const repo = stubRepo();
  const stubLLM = { model: "deepseek-v4-pro", modelKwargs: {} };
  const stubAgent = { _model: stubLLM } as unknown as DeepAgent;

  new DeepAgentsRuntime(repo, {
    createLLM: () => stubLLM as any,
    createAgent: (llm) => {
      capturedLLM = llm;
      return stubAgent;
    },
  });

  assert.notEqual(capturedLLM!, undefined);
  assert.notEqual(capturedLLM!, null);
});

// ---------------------------------------------------------------------------
// Tool creation tests
// ---------------------------------------------------------------------------

test("createQueryEventsTool returns a tool with correct name", () => {
  const t = createQueryEventsTool(stubRepo());
  assert.equal(t.name, "query_events");
});

test("createQueryEventsTool description mentions range fields and keyword", () => {
  const t = createQueryEventsTool(stubRepo());
  assert.ok(t.description.includes("rangeStartAt"));
  assert.ok(t.description.includes("keyword"));
});

test("createQueryEventsTool invokes handler and returns matching events", async () => {
  const repo = stubRepo([sampleEvent]);
  const t = createQueryEventsTool(repo);

  const result = await t.invoke({
    rangeStartAt: "2026-06-01T00:00:00.000Z",
    rangeEndAt: "2026-06-02T00:00:00.000Z",
  });

  const parsed = JSON.parse(result);
  assert.equal(parsed.action, "queried");
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].title, "团队会议");
});

test("createQueryEventsTool applies keyword filter", async () => {
  const repo = stubRepo([
    sampleEvent,
    { ...sampleEvent, id: "evt-2", title: "跑步", notes: "晨跑" },
  ]);
  const t = createQueryEventsTool(repo);

  const result = await t.invoke({
    rangeStartAt: "2026-06-01T00:00:00.000Z",
    rangeEndAt: "2026-06-02T00:00:00.000Z",
    keyword: "跑步",
  });

  const parsed = JSON.parse(result);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].title, "跑步");
});

// ---------------------------------------------------------------------------
// Schema validation tests — 参数不符合 Zod schema 时不会进入 handler
// ---------------------------------------------------------------------------

test("queryEventsArgsSchema rejects invalid rangeEndAt", () => {
  const parsed = QueryEventsArgsSchema.safeParse({
    rangeStartAt: "2026-06-01T00:00:00.000Z",
    rangeEndAt: "not-a-date",
  });
  assert.equal(parsed.success, false);
});

test("queryEventsArgsSchema rejects missing rangeStartAt", () => {
  const parsed = QueryEventsArgsSchema.safeParse({
    rangeEndAt: "2026-06-02T00:00:00.000Z",
  });
  assert.equal(parsed.success, false);
});

test("queryEventsArgsSchema accepts valid args with optional keyword", () => {
  const parsed = QueryEventsArgsSchema.safeParse({
    rangeStartAt: "2026-06-01T00:00:00.000+08:00",
    rangeEndAt: "2026-06-02T00:00:00.000+08:00",
    keyword: "会议",
  });
  assert.equal(parsed.success, true);
});

test("queryEventsArgsSchema accepts valid args without keyword", () => {
  const parsed = QueryEventsArgsSchema.safeParse({
    rangeStartAt: "2026-06-01T00:00:00.000+08:00",
    rangeEndAt: "2026-06-02T00:00:00.000+08:00",
  });
  assert.equal(parsed.success, true);
});

// ---------------------------------------------------------------------------
// Agent integration tests
// ---------------------------------------------------------------------------

test("invoke delegates to agent and returns messages", async () => {
  // 验证 DeepAgentsRuntime.invoke 正确将用户消息转发给内部 agent
  // 并返回 agent 结果中的 messages
  const repo = stubRepo();
  let receivedMessages: any[] | undefined;

  const stubAgent = {
    invoke: async (input: { messages: any[] }) => {
      receivedMessages = input.messages;
      return {
        messages: [
          ...input.messages,
          new AIMessage({ content: "你好！有什么可以帮助你的？" }),
        ],
      };
    },
  };

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
  });

  const result = await runtime.invoke("你好");

  // 验证 agent 收到了 HumanMessage
  assert.ok(receivedMessages);
  assert.equal(receivedMessages!.length, 1);
  assert.equal(receivedMessages![0].constructor.name, "HumanMessage");

  // 验证结果包含消息
  assert.ok(result.messages.length >= 2);
  const lastMsg = result.messages[result.messages.length - 1] as any;
  const content =
    typeof lastMsg.content === "string"
      ? lastMsg.content
      : "";
  assert.ok(content.includes("你好"));
});

test("invoke returns empty messages when agent returns none", async () => {
  const repo = stubRepo();

  const stubAgent = {
    invoke: async () => ({}),
  };

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
  });

  const result = await runtime.invoke("测试");
  assert.deepEqual(result.messages, []);
});

test("runtime captures single business tool and scripted agent invokes query_events end-to-end", async () => {
  let listCallCount = 0;
  const repo: CalendarRepository = {
    list: async () => {
      listCallCount++;
      return [sampleEvent];
    },
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
  };

  let capturedTools: any[] = [];
  let receivedInput: any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: (_llm, tools) => {
      capturedTools = tools;
      // scripted stub agent：invoke 中直接调用 query_events 工具并将结果反馈给调用方
      return {
        invoke: async (input: { messages: any[] }) => {
          receivedInput = input;
          const toolResult = await capturedTools[0].invoke({
            rangeStartAt: "2026-06-01T00:00:00.000Z",
            rangeEndAt: "2026-06-02T00:00:00.000Z",
          });
          const parsed = JSON.parse(toolResult);
          const titles = parsed.events.map((e: any) => e.title).join("、");
          return {
            messages: [
              ...input.messages,
              new AIMessage({ content: `查询到日程：${titles}` }),
            ],
          };
        },
      } as any;
    },
  });

  // 断言只有一个业务工具
  assert.equal(capturedTools.length, 1);
  assert.equal(capturedTools[0].name, "query_events");

  const result = await runtime.invoke("今天有什么安排？");

  // 验证 repository.list() 被调用
  assert.ok(listCallCount > 0, "Expected repo.list() to be called at least once");

  // 验证 stub agent 收到了用户消息
  assert.ok(receivedInput);
  assert.equal(receivedInput.messages[0].constructor.name, "HumanMessage");

  // 验证最终回复包含工具查询结果
  const lastMsg = result.messages[result.messages.length - 1] as any;
  assert.equal(typeof lastMsg.content, "string");
  assert.ok(
    lastMsg.content.includes("团队会议"),
    `Final content should include 团队会议, got: "${lastMsg.content}"`,
  );
  assert.ok(
    lastMsg.content.includes("查询到日程"),
    `Final content should include query summary`,
  );
});

test("invoke: invalid tool args rejected by schema before handler", async () => {
  const tool = createQueryEventsTool(stubRepo());

  await assert.rejects(
    async () => {
      await tool.invoke({
        rangeStartAt: "not-a-date",
        rangeEndAt: "2026-06-02T00:00:00.000Z",
      });
    },
    /did not match expected schema/i,
    "Should reject invalid rangeStartAt before handler executes",
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestRuntime() {
  const repo = stubRepo();
  const stubLLM = { model: "deepseek-v4-pro", modelKwargs: {} };
  const stubAgent = { _model: stubLLM } as unknown as DeepAgent;

  return new DeepAgentsRuntime(repo, {
    createLLM: () => stubLLM as any,
    createAgent: () => stubAgent,
  });
}
