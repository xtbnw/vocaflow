import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  DeepAgentsRuntime,
  buildSystemPrompt,
  createQueryEventsTool,
  extractInterruptPayload,
  DEFAULT_LLM_CONFIG,
} from "../../../../backend/infrastructure/agent/deepAgentsRuntime";
import type { CalendarRepository } from "../../../../backend/domain/calendarRepository";
import type { CalendarEvent } from "../../../../backend/domain/calendarTypes";
import type { ToolReviewInterrupt } from "../../../../backend/domain/agentRuntime";
import { QueryEventsArgsSchema } from "../../../../backend/domain/calendarTypes";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import type { CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import { AIMessage } from "@langchain/core/messages";
import type { DeepAgent } from "deepagents";
import { StateGraph, Annotation, Command, isGraphInterrupt } from "@langchain/langgraph";

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
// Temp DB helpers for checkpoint tests
// ---------------------------------------------------------------------------

interface TempCheckpointer {
  checkpointer: SqliteSaver;
  db: Database.Database;
  dir: string;
  dbPath: string;
}

function createTempCheckpointer(): TempCheckpointer {
  const dir = mkdtempSync(join(tmpdir(), "vocaflow-test-"));
  const dbPath = join(dir, "checkpoints.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode=WAL");
  return { checkpointer: new SqliteSaver(db), db, dir, dbPath };
}

function stubCheckpointer(): SqliteSaver {
  const db = new Database(":memory:");
  return new SqliteSaver(db);
}

function testMetadata(overrides?: Partial<CheckpointMetadata>): CheckpointMetadata {
  return {
    source: "input",
    step: -1,
    parents: {},
    ...overrides,
  };
}

function testCheckpoint(overrides?: Partial<ReturnType<typeof emptyCheckpoint>>) {
  const cp = emptyCheckpoint();
  return { ...cp, ...overrides, id: overrides?.id ?? cp.id };
}

// ---------------------------------------------------------------------------
// Existing tests (updated for new invoke signature with threadId)
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

test("buildSystemPrompt allows clarification before create_event", () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /允许通过多轮对话逐步澄清/);
  assert.match(prompt, /仅当标题、精确开始时间和结束时间都足够明确时调用 create_event/);
  assert.match(prompt, /不得因为用户表达了创建意图就立即调用 create_event/);
  assert.match(prompt, /必须实际调用 query_events/);
  assert.doesNotMatch(prompt, /必须直接调用 create_event 工具/);
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
    getCheckpointer: () => stubCheckpointer(),
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
// Agent integration tests (updated for threadId)
// ---------------------------------------------------------------------------

test("invoke delegates to agent with threadId in configurable", async () => {
  const repo = stubRepo();
  let receivedMessages: any[] | undefined;
  let receivedConfig: any;

  const stubAgent = {
    invoke: async (input: { messages: any[] }, config?: any) => {
      receivedMessages = input.messages;
      receivedConfig = config;
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
    getCheckpointer: () => stubCheckpointer(),
  });

  const result = await runtime.invoke("你好", "thread-test-1");

  // 验证 agent 收到了 HumanMessage
  assert.ok(receivedMessages);
  assert.equal(receivedMessages!.length, 1);
  assert.equal(receivedMessages![0].constructor.name, "HumanMessage");

  // 验证 config 中传递了 thread_id
  assert.ok(receivedConfig);
  assert.deepEqual(receivedConfig.configurable, { thread_id: "thread-test-1" });

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
    getCheckpointer: () => stubCheckpointer(),
  });

  const result = await runtime.invoke("测试", "thread-empty");
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
        invoke: async (input: { messages: any[] }, _config?: any) => {
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
    getCheckpointer: () => stubCheckpointer(),
  });

  // 断言有三个业务工具
  assert.equal(capturedTools.length, 3);
  const toolNames = capturedTools.map((t) => t.name).sort();
  assert.deepEqual(toolNames, ["create_event", "delete_event", "query_events"]);
  const queryTool = capturedTools.find((t) => t.name === "query_events");
  assert.ok(queryTool);

  const result = await runtime.invoke("今天有什么安排？", "thread-e2e");

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
// Checkpoint & Thread lifecycle tests
// ---------------------------------------------------------------------------

test("SqliteSaver can persist and retrieve checkpoints", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-cp-1";

  try {
    const config = {
      configurable: { thread_id: threadId },
    };
    await checkpointer.put(
      config,
      testCheckpoint(),
      testMetadata(),
    );

    const tuple = await checkpointer.getTuple(config);
    assert.ok(tuple, "Expected checkpoint tuple to exist");
    assert.equal(tuple!.config?.configurable?.thread_id, threadId);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SqliteSaver deleteThread removes checkpoint", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-del-1";

  try {
    const config = {
      configurable: { thread_id: threadId },
    };
    await checkpointer.put(
      config,
      testCheckpoint(),
      testMetadata(),
    );

    // 确认存在
    let tuple = await checkpointer.getTuple(config);
    assert.ok(tuple, "Expected checkpoint to exist before deletion");

    // 删除
    await checkpointer.deleteThread(threadId);

    // 确认不存在
    tuple = await checkpointer.getTuple(config);
    assert.equal(tuple, undefined);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteThread on runtime delegates to SqliteSaver", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-del-runtime";

  try {
    const config = {
      configurable: { thread_id: threadId },
    };
    await checkpointer.put(
      config,
      testCheckpoint(),
      testMetadata(),
    );

    // 创建 runtime 并注入同一个 checkpointer
    const repo = stubRepo();
    const stubAgent = {
      invoke: async (input: any, _config?: any) => ({
        messages: [...input.messages, new AIMessage({ content: "ok" })],
      }),
    };

    const runtime = new DeepAgentsRuntime(repo, {
      createLLM: () => stubAgent as any,
      createAgent: () => stubAgent as any,
      getCheckpointer: () => checkpointer,
    });

    // 确认 checkpoint 存在
    let tuple = await checkpointer.getTuple(config);
    assert.ok(tuple, "Expected checkpoint to exist before deleteThread");

    // 通过 runtime 删除
    await runtime.deleteThread(threadId);

    // 确认已删除
    tuple = await checkpointer.getTuple(config);
    assert.equal(tuple, undefined);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-creating runtime with same checkpoint DB preserves thread state", async () => {
  const { dbPath, checkpointer: saver1, db: db1, dir } = createTempCheckpointer();
  const threadId = "thread-recreate";

  try {
    // Phase 1: 用 saver1 写入 checkpoint
    const config = {
      configurable: { thread_id: threadId },
    };
    await saver1.put(
      config,
      testCheckpoint(),
      testMetadata(),
    );

    // 关闭第一个连接，确认数据已落盘
    db1.close();

    // Phase 2: 用同一个 dbPath 打开第二个连接，模拟"重新创建 runtime"
    const db2 = new Database(dbPath);
    db2.pragma("journal_mode=WAL");
    const saver2 = new SqliteSaver(db2);

    try {
      const tuple = await saver2.getTuple(config);
      assert.ok(tuple, "Expected thread state to be readable from re-created checkpointer");
      assert.equal(tuple!.config?.configurable?.thread_id, threadId);
    } finally {
      db2.close();
    }
  } finally {
    // db1 已在 phase 1 关闭；如果 phase 1 抛异常则在此兜底
    try { db1.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invoke with same threadId passes consistent config to agent", async () => {
  // 验证同一 threadId 在连续两次 invoke 中都传递相同 thread_id
  const repo = stubRepo();
  const configsReceived: any[] = [];

  const stubAgent = {
    invoke: async (input: any, config?: any) => {
      configsReceived.push(config);
      return {
        messages: [...input.messages, new AIMessage({ content: "ok" })],
      };
    },
  };

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  await runtime.invoke("第一条消息", "thread-consistent");
  await runtime.invoke("第二条消息", "thread-consistent");

  assert.equal(configsReceived.length, 2);
  assert.deepEqual(configsReceived[0].configurable, { thread_id: "thread-consistent" });
  assert.deepEqual(configsReceived[1].configurable, { thread_id: "thread-consistent" });
});

test("invoke with different threadIds passes distinct config to agent", async () => {
  const repo = stubRepo();
  const configsReceived: any[] = [];

  const stubAgent = {
    invoke: async (input: any, config?: any) => {
      configsReceived.push(config);
      return {
        messages: [...input.messages, new AIMessage({ content: "ok" })],
      };
    },
  };

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  await runtime.invoke("消息A", "thread-a");
  await runtime.invoke("消息B", "thread-b");

  assert.equal(configsReceived.length, 2);
  assert.deepEqual(configsReceived[0].configurable, { thread_id: "thread-a" });
  assert.deepEqual(configsReceived[1].configurable, { thread_id: "thread-b" });
});

test("SqliteSaver with :memory: DB supports full checkpoint lifecycle", async () => {
  const db = new Database(":memory:");
  const checkpointer = new SqliteSaver(db);
  const threadId = "thread-mem-lifecycle";

  const config = {
    configurable: { thread_id: threadId },
  };

  // 初始状态：无 checkpoint
  let tuple = await checkpointer.getTuple(config);
  assert.equal(tuple, undefined);

  // 写入
  await checkpointer.put(
    config,
    testCheckpoint(),
    testMetadata(),
  );

  // 确认存在
  tuple = await checkpointer.getTuple(config);
  assert.ok(tuple);

  // 追加第二个 checkpoint
  await checkpointer.put(
    config,
    testCheckpoint(),
    testMetadata({ source: "loop", step: 1 }),
  );

  tuple = await checkpointer.getTuple(config);
  assert.ok(tuple);

  // 删除
  await checkpointer.deleteThread(threadId);
  tuple = await checkpointer.getTuple(config);
  assert.equal(tuple, undefined);
});

// ---------------------------------------------------------------------------
// Interrupt & Resume tests
// ---------------------------------------------------------------------------

test("runtime registers three business tools", async () => {
  let capturedTools: any[] = [];
  const repo = stubRepo();

  new DeepAgentsRuntime(repo, {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: (_llm, tools) => {
      capturedTools = tools;
      return { invoke: async () => ({ messages: [] }) } as any;
    },
    getCheckpointer: () => stubCheckpointer(),
  });

  assert.equal(capturedTools.length, 3);
  const names = capturedTools.map((t) => t.name).sort();
  assert.deepEqual(names, ["create_event", "delete_event", "query_events"]);
});

test("runtime create_event tool has CreateEventArgsSchema", async () => {
  let capturedTools: any[] = [];
  const repo = stubRepo();

  new DeepAgentsRuntime(repo, {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: (_llm, tools) => {
      capturedTools = tools;
      return { invoke: async () => ({ messages: [] }) } as any;
    },
    getCheckpointer: () => stubCheckpointer(),
  });

  const createTool = capturedTools.find((t) => t.name === "create_event");
  assert.ok(createTool, "create_event tool should be registered");
  assert.notEqual(createTool.schema, undefined);
});

test("runtime delete_event tool has DeleteEventArgsSchema", async () => {
  let capturedTools: any[] = [];
  const repo = stubRepo();

  new DeepAgentsRuntime(repo, {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: (_llm, tools) => {
      capturedTools = tools;
      return { invoke: async () => ({ messages: [] }) } as any;
    },
    getCheckpointer: () => stubCheckpointer(),
  });

  const deleteTool = capturedTools.find((t) => t.name === "delete_event");
  assert.ok(deleteTool, "delete_event tool should be registered");
  assert.notEqual(deleteTool.schema, undefined);
});

test("stream yields interrupt when GraphInterrupt is caught via checkpointer fallback", async () => {
  // 模拟：streamEvents 正常结束（没抛异常），但 checkpoint 中存在 __interrupt__
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-int-fallback";
  const config = { configurable: { thread_id: threadId } };

  try {
    // 写入包含 interrupt 的 checkpoint（模拟 graph 中断后的状态）
    const interruptPayload = {
      kind: "tool_review",
      action: "create_event",
      arguments: { title: "测试", startAt: "2026-06-01T09:00:00.000Z" },
      preview: {
        title: "创建日程",
        summary: "将在日历中创建以下日程",
        items: [{ label: "标题", value: "测试" }],
      },
    };

    const cp = testCheckpoint();
    (cp as any).channel_values = {
      __interrupt__: [{ value: interruptPayload }],
    };
    await checkpointer.put(config, cp, testMetadata());

    // 创建 runtime，agent 不抛异常但也不设置 completed
    const repo = stubRepo();
    const stubAgent = {
      streamEvents: async function* () {
        // 模拟空流：没有 done 事件
        yield {
          method: "messages",
          params: { data: { event: "message-start", id: "msg-1" } },
        };
        // 流自然结束，不抛异常
      },
    } as any;

    const runtime = new DeepAgentsRuntime(repo, {
      createLLM: () => stubAgent as any,
      createAgent: () => stubAgent as any,
      getCheckpointer: () => checkpointer,
    });

    const events: any[] = [];
    for await (const ev of runtime.stream("创建测试日程", threadId)) {
      events.push(ev);
    }

    // 应该包含 interrupt 事件
    const interruptEv = events.find((e) => e.type === "interrupt");
    assert.ok(interruptEv, "Expected interrupt event in stream");
    assert.equal(interruptEv.review.kind, "tool_review");
    assert.equal(interruptEv.review.action, "create_event");
    assert.equal(interruptEv.review.preview.title, "创建日程");

    // 不应包含 done 事件
    const doneEv = events.find((e) => e.type === "done");
    assert.equal(doneEv, undefined, "Expected no done event on interrupt");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stream yields interrupt when GraphInterrupt error is thrown", async () => {
  const repo = stubRepo();
  const interruptPayload = {
    kind: "tool_review",
    action: "delete_event",
    arguments: { eventIds: ["evt-1"] },
    preview: {
      title: "删除日程",
      summary: "将删除 1 个日程",
      items: [{ label: "日程数量", value: "1 个日程" }],
      warnings: ["该操作会永久删除日程，不可撤销"],
    },
  };

  // 构造一个能通过 isGraphInterrupt 检查的错误
  const graphInterruptErr = new Error("GraphInterrupt") as any;
  graphInterruptErr.name = "GraphInterrupt";
  graphInterruptErr.interrupts = [{ value: interruptPayload }];
  // 添加 GraphBubbleUp / GraphInterrupt 内部标记
  Object.setPrototypeOf(graphInterruptErr, Error.prototype);

  const stubAgent = {
    streamEvents: async function* () {
      yield {
        method: "messages",
        params: { data: { event: "message-start", id: "msg-1" } },
      };
      throw graphInterruptErr;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("删除日程", "thread-err-int")) {
    events.push(ev);
  }

  // 应该包含 interrupt 事件（从 GraphInterrupt 错误中提取）
  const interruptEv = events.find((e) => e.type === "interrupt");
  assert.ok(interruptEv, "Expected interrupt event when GraphInterrupt is thrown");
  assert.equal(interruptEv.review.kind, "tool_review");
  assert.equal(interruptEv.review.action, "delete_event");
});

test("resume calls agent.streamEvents with Command containing resume value", async () => {
  const repo = stubRepo();
  let receivedInput: any;

  const stubAgent = {
    streamEvents: async function* (input: any) {
      receivedInput = input;
      yield {
        method: "messages",
        params: {
          data: {
            event: "content-block-delta",
            delta: { type: "text-delta", text: "已批准执行" },
          },
        },
      };
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.resume(
    { decision: "approve" },
    "thread-resume-1",
  )) {
    events.push(ev);
  }

  // 验证 streamEvents 收到了 Command
  assert.ok(receivedInput, "Expected agent.streamEvents to be called");
  // Command 实例有 lg_name 属性
  assert.equal(receivedInput.lg_name, "Command", "Expected Command instance");
});

test("resume with reject also passes Command to agent", async () => {
  const repo = stubRepo();
  let receivedInput: any;

  const stubAgent = {
    streamEvents: async function* (input: any) {
      receivedInput = input;
      yield {
        method: "messages",
        params: {
          data: {
            event: "content-block-delta",
            delta: { type: "text-delta", text: "已取消" },
          },
        },
      };
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.resume(
    { decision: "reject" },
    "thread-reject-1",
  )) {
    events.push(ev);
  }

  assert.ok(receivedInput, "Expected agent.streamEvents to be called");
  assert.equal(receivedInput.lg_name, "Command");
});

test("stream emits events_changed after successful create_event tool_finished", async () => {
  const repo = stubRepo();
  const stubAgent = {
    streamEvents: async function* () {
      yield {
        method: "tools",
        params: {
          data: {
            event: "tool-started",
            tool_call_id: "call-1",
            tool_name: "create_event",
            input: { title: "测试" },
          },
        },
      };
      yield {
        method: "tools",
        params: {
          data: {
            event: "tool-finished",
            tool_call_id: "call-1",
            tool_name: "create_event",
            output: JSON.stringify({ action: "created", event: { title: "测试" } }),
          },
        },
      };
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("创建日程", "thread-ev-changed")) {
    events.push(ev);
  }

  const ec = events.find((e) => e.type === "events_changed");
  assert.ok(ec, "Expected events_changed event after successful create_event");
  const doneEv = events.find((e) => e.type === "done");
  assert.ok(doneEv, "Expected done event");
});

test("stream does not emit events_changed after rejected write", async () => {
  const repo = stubRepo();
  const stubAgent = {
    streamEvents: async function* () {
      yield {
        method: "tools",
        params: {
          data: {
            event: "tool-started",
            tool_call_id: "call-2",
            tool_name: "delete_event",
            input: { eventIds: ["evt-1"] },
          },
        },
      };
      yield {
        method: "tools",
        params: {
          data: {
            event: "tool-finished",
            tool_call_id: "call-2",
            tool_name: "delete_event",
            output: JSON.stringify({ action: "rejected", message: "操作已取消" }),
          },
        },
      };
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("删除日程", "thread-rejected")) {
    events.push(ev);
  }

  const ec = events.find((e) => e.type === "events_changed");
  assert.equal(ec, undefined, "Expected NO events_changed for rejected action");
});

test("checkpoint rebuild — runtime re-creation with same DB preserves interrupt", async () => {
  const { dbPath, checkpointer: saver1, db: db1, dir } = createTempCheckpointer();
  const threadId = "thread-rebuild";

  try {
    const config = { configurable: { thread_id: threadId } };
    const interruptPayload = {
      kind: "tool_review",
      action: "create_event",
      arguments: { title: "重建测试", startAt: "2026-06-01T09:00:00.000Z" },
      preview: {
        title: "创建日程",
        summary: "测试重建",
        items: [],
      },
    };

    // Phase 1: 用第一个 checkpointer 写入包含 interrupt 的 checkpoint
    const cp = testCheckpoint();
    (cp as any).channel_values = {
      __interrupt__: [{ value: interruptPayload }],
    };
    await saver1.put(config, cp, testMetadata());
    db1.close();

    // Phase 2: 用同一个 dbPath 重新打开，模拟"重建 runtime"
    const db2 = new Database(dbPath);
    db2.pragma("journal_mode=WAL");
    const saver2 = new SqliteSaver(db2);

    try {
      // 验证 interrupt 仍然可读
      const tuple = await saver2.getTuple(config);
      assert.ok(tuple, "Expected checkpoint to exist after rebuild");
      const channelValues = tuple!.checkpoint?.channel_values as any;
      assert.ok(channelValues, "Expected channel_values");
      assert.ok("__interrupt__" in channelValues, "Expected __interrupt__ in channel_values");

      const interrupts = channelValues.__interrupt__;
      assert.equal(interrupts.length, 1);
      assert.equal(interrupts[0].value.kind, "tool_review");

      // 用重建的 checkpointer 创建 runtime，验证 stream 能检测到 interrupt
      const repo = stubRepo();
      const stubAgent = {
        streamEvents: async function* () {
          yield {
            method: "messages",
            params: { data: { event: "message-start", id: "msg-1" } },
          };
        },
      } as any;

      const runtime = new DeepAgentsRuntime(repo, {
        createLLM: () => stubAgent as any,
        createAgent: () => stubAgent as any,
        getCheckpointer: () => saver2,
      });

      const events: any[] = [];
      for await (const ev of runtime.stream("重建测试", threadId)) {
        events.push(ev);
      }

      const interruptEv = events.find((e) => e.type === "interrupt");
      assert.ok(interruptEv, "Expected interrupt event after runtime rebuild");
      assert.equal(interruptEv.review.action, "create_event");
    } finally {
      db2.close();
    }
  } finally {
    try { db1.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Real LangGraph interrupt/resume tests with calendarWriteTools
// ---------------------------------------------------------------------------

/**
 * Helper: invoke a graph and extract the interrupt value from the result.
 * graph.invoke() includes __interrupt__ in the returned state when interrupt() is called.
 */
async function extractInterruptFromGraph(
  graph: ReturnType<typeof import("@langchain/langgraph").StateGraph.prototype.compile>,
  input: Record<string, unknown>,
  threadId: string,
): Promise<unknown> {
  const result = await graph.invoke(input, { configurable: { thread_id: threadId } });
  const interrupts = (result as Record<string, unknown>).__interrupt__ as Array<{ value: unknown }> | undefined;
  if (interrupts && interrupts.length > 0) return interrupts[0].value;
  return null;
}

test("real LG: create_event interrupt then approve saves exactly once", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-lg-create-approve";

  const saved: CalendarEvent[] = [];
  const repo: CalendarRepository = {
    list: async () => [],
    save: async (e) => { saved.push(e as CalendarEvent); return e as CalendarEvent; },
    update: async (e) => e as CalendarEvent,
    delete: async () => {},
  };

  const { createCreateEventTool } = await import("../../../../backend/infrastructure/agent/calendarWriteTools");
  const tool = createCreateEventTool(repo);

  const TestState = Annotation.Root({
    result: Annotation<string>({
      default: () => "",
      reducer: (_prev: string, next: string) => next ?? _prev,
    }),
  });

  try {
    const graph = new StateGraph(TestState)
      .addNode("execute", async (_state) => {
        const r = await tool.invoke({
          title: "新会议",
          startAt: "2026-06-15T14:00:00.000Z",
        });
        return { result: r };
      })
      .addEdge("__start__", "execute")
      .compile({ checkpointer });

    const interruptValue = await extractInterruptFromGraph(
      graph, { result: "" }, threadId,
    );
    assert.ok(interruptValue, "Expected interrupt after first invoke");
    assert.equal((interruptValue as Record<string, unknown>).kind, "tool_review");
    assert.equal((interruptValue as Record<string, unknown>).action, "create_event");
    // No save before interrupt
    assert.equal(saved.length, 0);

    // Resume with approve
    const result = await graph.invoke(
      new Command({ resume: { decision: "approve" } }),
      { configurable: { thread_id: threadId } },
    );

    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, "新会议");
    assert.ok((result.result as string).includes("created"));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real LG: create_event interrupt then reject does NOT save", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-lg-create-reject";

  const saved: CalendarEvent[] = [];
  const repo: CalendarRepository = {
    list: async () => [],
    save: async (e) => { saved.push(e as CalendarEvent); return e as CalendarEvent; },
    update: async (e) => e as CalendarEvent,
    delete: async () => {},
  };

  const { createCreateEventTool } = await import("../../../../backend/infrastructure/agent/calendarWriteTools");
  const tool = createCreateEventTool(repo);

  const TestState = Annotation.Root({
    result: Annotation<string>({
      default: () => "",
      reducer: (_prev: string, next: string) => next ?? _prev,
    }),
  });

  try {
    const graph = new StateGraph(TestState)
      .addNode("execute", async (_state) => {
        const r = await tool.invoke({
          title: "废弃日程",
          startAt: "2026-07-01T10:00:00.000Z",
        });
        return { result: r };
      })
      .addEdge("__start__", "execute")
      .compile({ checkpointer });

    const interruptValue = await extractInterruptFromGraph(
      graph, { result: "" }, threadId,
    );
    assert.ok(interruptValue, "Expected interrupt");
    assert.equal(saved.length, 0);

    // Resume with reject
    const result = await graph.invoke(
      new Command({ resume: { decision: "reject" } }),
      { configurable: { thread_id: threadId } },
    );

    assert.equal(saved.length, 0, "No save after reject");
    assert.ok((result.result as string).includes("rejected"));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real LG: duplicate resume does not double-write", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-lg-dup-resume";

  const saved: CalendarEvent[] = [];
  const repo: CalendarRepository = {
    list: async () => [],
    save: async (e) => { saved.push(e as CalendarEvent); return e as CalendarEvent; },
    update: async (e) => e as CalendarEvent,
    delete: async () => {},
  };

  const { createCreateEventTool } = await import("../../../../backend/infrastructure/agent/calendarWriteTools");
  const tool = createCreateEventTool(repo);

  const TestState = Annotation.Root({
    result: Annotation<string>({
      default: () => "",
      reducer: (_prev: string, next: string) => next ?? _prev,
    }),
  });

  try {
    const graph = new StateGraph(TestState)
      .addNode("execute", async (_state) => {
        const r = await tool.invoke({
          title: "不重复日程",
          startAt: "2026-08-01T09:00:00.000Z",
        });
        return { result: r };
      })
      .addEdge("__start__", "execute")
      .compile({ checkpointer });

    // First: trigger interrupt
    const interruptValue = await extractInterruptFromGraph(
      graph, { result: "" }, threadId,
    );
    assert.ok(interruptValue, "Expected interrupt");

    // First resume: approve
    await graph.invoke(
      new Command({ resume: { decision: "approve" } }),
      { configurable: { thread_id: threadId } },
    );
    assert.equal(saved.length, 1);

    // Second resume with same thread — graph has already passed the interrupt point
    await graph.invoke(
      new Command({ resume: { decision: "approve" } }),
      { configurable: { thread_id: threadId } },
    );
    assert.equal(saved.length, 1, "No double-save on repeated resume");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real LG: create_event interrupt preview includes conflict warnings", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-lg-conflict";

  const existingEvent: CalendarEvent = {
    id: "existing-1",
    title: "已有会议",
    startAt: "2026-06-15T14:30:00.000Z",
    endAt: "2026-06-15T15:30:00.000Z",
    source: "text",
    createdAt: "2026-05-31T12:00:00.000Z",
    updatedAt: "2026-05-31T12:00:00.000Z",
  };

  const repo: CalendarRepository = {
    list: async () => [existingEvent],
    save: async (e) => e as CalendarEvent,
    update: async (e) => e as CalendarEvent,
    delete: async () => {},
  };

  const { createCreateEventTool } = await import("../../../../backend/infrastructure/agent/calendarWriteTools");
  const tool = createCreateEventTool(repo);

  const TestState = Annotation.Root({
    result: Annotation<string>({
      default: () => "",
      reducer: (_prev: string, next: string) => next ?? _prev,
    }),
  });

  try {
    const graph = new StateGraph(TestState)
      .addNode("execute", async (_state) => {
        const r = await tool.invoke({
          title: "新会议",
          startAt: "2026-06-15T14:00:00.000Z",
          endAt: "2026-06-15T15:00:00.000Z",
        });
        return { result: r };
      })
      .addEdge("__start__", "execute")
      .compile({ checkpointer });

    const interruptValue = await extractInterruptFromGraph(
      graph, { result: "" }, threadId,
    );
    assert.ok(interruptValue, "Expected interrupt");

    const preview = (interruptValue as Record<string, unknown>).preview as Record<string, unknown>;
    assert.equal(preview.title, "创建日程");
    const warnings = preview.warnings as string[];
    assert.ok(warnings && warnings.length > 0, "Expected conflict warnings");
    assert.ok(warnings.some((w) => w.includes("已有会议")), `Expected warning about 已有会议, got: ${warnings.join(", ")}`);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real LG: delete_event interrupt then reject does NOT delete", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-lg-delete-reject";

  const deleted: string[] = [];
  const repo: CalendarRepository = {
    list: async () => [sampleEvent],
    save: async (e) => e as CalendarEvent,
    update: async (e) => e as CalendarEvent,
    delete: async (id) => { deleted.push(id as string); },
  };

  const { createDeleteEventTool } = await import("../../../../backend/infrastructure/agent/calendarWriteTools");
  const tool = createDeleteEventTool(repo);

  const TestState = Annotation.Root({
    result: Annotation<string>({
      default: () => "",
      reducer: (_prev: string, next: string) => next ?? _prev,
    }),
  });

  try {
    const graph = new StateGraph(TestState)
      .addNode("execute", async (_state) => {
        const r = await tool.invoke({ eventIds: ["evt-1"] });
        return { result: r };
      })
      .addEdge("__start__", "execute")
      .compile({ checkpointer });

    const interruptValue = await extractInterruptFromGraph(
      graph, { result: "" }, threadId,
    );
    assert.ok(interruptValue, "Expected interrupt");
    assert.equal((interruptValue as Record<string, unknown>).kind, "tool_review");
    assert.equal((interruptValue as Record<string, unknown>).action, "delete_event");
    assert.equal(deleted.length, 0, "No delete before interrupt");

    // Resume with reject
    const result = await graph.invoke(
      new Command({ resume: { decision: "reject" } }),
      { configurable: { thread_id: threadId } },
    );

    assert.equal(deleted.length, 0, "No delete after reject");
    assert.ok((result.result as string).includes("rejected"));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real LG: delete_event interrupt then approve deletes exactly once", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-lg-delete-approve";

  const deleted: string[] = [];
  const repo: CalendarRepository = {
    list: async () => [sampleEvent],
    save: async (e) => e as CalendarEvent,
    update: async (e) => e as CalendarEvent,
    delete: async (id) => { deleted.push(id as string); },
  };

  const { createDeleteEventTool } = await import("../../../../backend/infrastructure/agent/calendarWriteTools");
  const tool = createDeleteEventTool(repo);

  const TestState = Annotation.Root({
    result: Annotation<string>({
      default: () => "",
      reducer: (_prev: string, next: string) => next ?? _prev,
    }),
  });

  try {
    const graph = new StateGraph(TestState)
      .addNode("execute", async (_state) => {
        const r = await tool.invoke({ eventIds: ["evt-1"] });
        return { result: r };
      })
      .addEdge("__start__", "execute")
      .compile({ checkpointer });

    const interruptValue = await extractInterruptFromGraph(
      graph, { result: "" }, threadId,
    );
    assert.ok(interruptValue, "Expected interrupt");
    assert.equal(deleted.length, 0, "No delete before interrupt");

    // Resume with approve
    const result = await graph.invoke(
      new Command({ resume: { decision: "approve" } }),
      { configurable: { thread_id: threadId } },
    );

    assert.equal(deleted.length, 1, "Delete after approve");
    assert.equal(deleted[0], "evt-1");
    assert.ok((result.result as string).includes("deleted"));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// extractInterruptPayload 单元测试
// ---------------------------------------------------------------------------

test("extractInterruptPayload returns null for non-GraphInterrupt error", () => {
  const err = new Error("plain error");
  const result = extractInterruptPayload(err);
  assert.equal(result, null);
});

test("extractInterruptPayload returns null for GraphInterrupt without interrupts", () => {
  const err = new Error("GraphInterrupt") as any;
  // No interrupts array
  const result = extractInterruptPayload(err);
  assert.equal(result, null);
});

test("extractInterruptPayload returns payload for valid GraphInterrupt", () => {
  const payload: ToolReviewInterrupt = {
    kind: "tool_review",
    action: "create_event",
    arguments: { title: "test" },
    preview: { title: "创建日程", summary: "test", items: [] },
  };
  const err = new Error("GraphInterrupt") as any;
  err.interrupts = [{ value: payload }];
  const result = extractInterruptPayload(err);
  assert.equal(result?.kind, "tool_review");
  assert.equal(result?.action, "create_event");
});

test("extractInterruptPayload returns payload when interrupt array is thrown directly", () => {
  const payload: ToolReviewInterrupt = {
    kind: "tool_review",
    action: "delete_event",
    arguments: { eventIds: ["evt-direct-array"] },
    preview: { title: "删除日程", summary: "test", items: [] },
  };

  const result = extractInterruptPayload([{ id: "interrupt-1", value: payload }]);

  assert.equal(result?.kind, "tool_review");
  assert.equal(result?.action, "delete_event");
});

// ---------------------------------------------------------------------------
// HumanMessage 不被污染
// ---------------------------------------------------------------------------

test("stream passes user message as clean HumanMessage (no date context injected)", async () => {
  const repo = stubRepo();
  let capturedMessages: any[] | undefined;

  const stubAgent = {
    streamEvents: async function* (input: any) {
      capturedMessages = input.messages;
      yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const userInput = "明天下午有什么安排？";
  const events: any[] = [];
  for await (const ev of runtime.stream(userInput, "thread-clean-msg")) {
    events.push(ev);
  }

  assert.ok(capturedMessages, "streamEvents 应被调用");
  assert.equal(capturedMessages!.length, 2, "应有 SystemMessage + HumanMessage 两条");

  // 第一条是 SystemMessage（日期上下文）
  assert.equal(
    capturedMessages![0].constructor.name,
    "SystemMessage",
    "第一条应为 SystemMessage",
  );

  // 第二条是 HumanMessage（用户原始输入）
  assert.equal(
    capturedMessages![1].constructor.name,
    "HumanMessage",
    "第二条应为 HumanMessage",
  );
  assert.equal(
    capturedMessages![1].content,
    userInput,
    "HumanMessage.content 应为用户原始输入，未被拼接时间上下文",
  );
});

// ---------------------------------------------------------------------------
// eventStream.output 竞态 stub 测试
// ---------------------------------------------------------------------------

test("stream: output rejects with GraphInterrupt after iterator ends → emit interrupt, no done", async () => {
  const repo = stubRepo();
  const interruptPayload: ToolReviewInterrupt = {
    kind: "tool_review",
    action: "create_event",
    arguments: { title: "竞态测试" },
    preview: { title: "创建日程", summary: "竞态", items: [] },
  };

  const graphErr = new Error("GraphInterrupt") as any;
  graphErr.interrupts = [{ value: interruptPayload }];

  const stubAgent = {
    streamEvents: async () => {
      async function* gen() {
        yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
        // iterator 先结束，不抛异常
      }
      const it = gen();
      // output Promise 在 microtask 中 reject，模拟竞态
      (it as any).output = new Promise((_, reject) => {
        queueMicrotask(() => reject(graphErr));
      });
      return it;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("创建竞态测试日程", "thread-out-int")) {
    events.push(ev);
  }

  const interruptEv = events.find((e: any) => e.type === "interrupt");
  assert.ok(interruptEv, "应从 output rejection 中提取 interrupt");
  assert.equal(interruptEv.review.action, "create_event");

  const doneEv = events.find((e: any) => e.type === "done");
  assert.equal(doneEv, undefined, "interrupt 时不应有 done");
});

test("stream: iterator throws interrupt array directly → emit interrupt, no done", async () => {
  const repo = stubRepo();
  const interruptPayload: ToolReviewInterrupt = {
    kind: "tool_review",
    action: "create_event",
    arguments: { title: "数组竞态测试" },
    preview: { title: "创建日程", summary: "test", items: [] },
  };
  const stubAgent = {
    streamEvents: async () => {
      async function* gen() {
        throw [{ id: "interrupt-direct", value: interruptPayload }];
      }
      return gen();
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("test", "thread-direct-array")) {
    events.push(ev);
  }

  assert.equal(events.find((e: any) => e.type === "interrupt")?.review.action, "create_event");
  assert.equal(events.find((e: any) => e.type === "done"), undefined);
});

test("stream: consumes rejected v3 toolCalls projection output", async () => {
  const repo = stubRepo();
  const interruptPayload: ToolReviewInterrupt = {
    kind: "tool_review",
    action: "delete_event",
    arguments: { eventIds: ["evt-projection"] },
    preview: { title: "删除日程", summary: "test", items: [] },
  };
  const stubAgent = {
    streamEvents: async () => {
      async function* protocolEvents() {
        yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
      }
      async function* toolCalls() {
        yield { output: Promise.reject([{ id: "projection-int", value: interruptPayload }]) };
      }
      const it = protocolEvents();
      (it as any).output = Promise.resolve(undefined);
      (it as any).interrupted = true;
      (it as any).interrupts = [{ interruptId: "projection-int", payload: interruptPayload }];
      (it as any).toolCalls = toolCalls();
      return it;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("test", "thread-projection")) {
    events.push(ev);
  }

  assert.equal(events.find((e: any) => e.type === "interrupt")?.review.action, "delete_event");
  assert.equal(events.find((e: any) => e.type === "done"), undefined);
});

test("stream: output rejects with network error → emit error", async () => {
  const repo = stubRepo();
  const netErr = new Error("fetch failed: ECONNREFUSED");

  const stubAgent = {
    streamEvents: async () => {
      async function* gen() {
        yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
      }
      const it = gen();
      (it as any).output = Promise.reject(netErr);
      // 防止 mocha/node 报告 unhandledRejection（测试框架会捕获但明确 suppress）
      (it as any).output.catch(() => {});
      return it;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("test", "thread-net-err")) {
    events.push(ev);
  }

  const errEv = events.find((e: any) => e.type === "error");
  assert.ok(errEv, "应输出 error 事件");
  assert.equal(errEv.code, "NETWORK_ERROR");
});

test("stream: output resolves normally → emit done", async () => {
  const repo = stubRepo();
  let abortCalls = 0;
  const stubAgent = {
    streamEvents: async () => {
      async function* gen() {
        yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
      }
      const it = gen();
      (it as any).output = Promise.resolve(undefined);
      (it as any).interrupted = false;
      (it as any).abort = async () => { abortCalls += 1; };
      return it;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const start = Date.now();
  const events: any[] = [];
  for await (const ev of runtime.stream("test", "thread-normal")) {
    events.push(ev);
  }
  const elapsed = Date.now() - start;

  const doneEv = events.find((e: any) => e.type === "done");
  assert.ok(doneEv, "正常结束应有 done 事件");
  const errEv = events.find((e: any) => e.type === "error");
  assert.equal(errEv, undefined, "正常结束不应有 error");
  const intEv = events.find((e: any) => e.type === "interrupt");
  assert.equal(intEv, undefined, "正常结束不应有 interrupt");
  assert.equal(abortCalls, 0, "正常结束后不应调用 abort");
  assert.ok(elapsed < 100, `公开 API 正常完成时不应轮询 checkpoint，实际耗时 ${elapsed}ms`);
});

test("stream: interrupted true with public payload → emit interrupt, no done", async () => {
  const repo = stubRepo();
  const interruptPayload: ToolReviewInterrupt = {
    kind: "tool_review",
    action: "delete_event",
    arguments: { eventIds: ["evt-public"] },
    preview: { title: "删除日程", summary: "test", items: [] },
  };
  const stubAgent = {
    streamEvents: async () => {
      async function* gen() {
        yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
      }
      const it = gen();
      (it as any).output = Promise.resolve(undefined);
      (it as any).interrupted = true;
      (it as any).interrupts = [{ interruptId: "public-int", payload: interruptPayload }];
      return it;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("test", "thread-public-int")) {
    events.push(ev);
  }

  assert.equal(events.find((e: any) => e.type === "interrupt")?.review.action, "delete_event");
  assert.equal(events.find((e: any) => e.type === "done"), undefined);
});

test("stream: interrupted true without supported payload → emit STREAM_ERROR, no done", async () => {
  const repo = stubRepo();
  const stubAgent = {
    streamEvents: async () => {
      async function* gen() {
        yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
      }
      const it = gen();
      (it as any).output = Promise.resolve(undefined);
      (it as any).interrupted = true;
      (it as any).interrupts = [{ interruptId: "unsupported-int", payload: { kind: "unsupported_interrupt" } }];
      return it;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(repo, {
    createLLM: () => stubAgent as any,
    createAgent: () => stubAgent as any,
    getCheckpointer: () => stubCheckpointer(),
  });

  const events: any[] = [];
  for await (const ev of runtime.stream("test", "thread-unsupported-int")) {
    events.push(ev);
  }

  const error = events.find((e: any) => e.type === "error");
  assert.equal(error?.code, "STREAM_ERROR");
  assert.match(error?.message ?? "", /without a supported review payload/);
  assert.equal(events.find((e: any) => e.type === "done"), undefined);
});

test("stream: output resolves but checkpoint has interrupt → emit interrupt via fallback", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-cp-fallback-int";

  const interruptPayload: ToolReviewInterrupt = {
    kind: "tool_review",
    action: "delete_event",
    arguments: { eventIds: ["evt-1"] },
    preview: { title: "删除日程", summary: "test", items: [{ label: "数量", value: "1" }] },
  };

  // 预写入包含 interrupt 的 checkpoint
  const config = { configurable: { thread_id: threadId } };
  const cp = testCheckpoint();
  (cp as any).channel_values = {
    __interrupt__: [{ value: interruptPayload }],
  };
  await checkpointer.put(config, cp, testMetadata());

  try {
    const repo = stubRepo();
    const stubAgent = {
      streamEvents: async () => {
        async function* gen() {
          yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
        }
        const it = gen();
        (it as any).output = Promise.resolve(undefined);
        return it;
      },
    } as any;

    const runtime = new DeepAgentsRuntime(repo, {
      createLLM: () => stubAgent as any,
      createAgent: () => stubAgent as any,
      getCheckpointer: () => checkpointer,
    });

    const events: any[] = [];
    for await (const ev of runtime.stream("test", threadId)) {
      events.push(ev);
    }

    const interruptEv = events.find((e: any) => e.type === "interrupt");
    assert.ok(interruptEv, "checkpoint fallback 应捕获 interrupt");
    assert.equal(interruptEv.review.action, "delete_event");

    const doneEv = events.find((e: any) => e.type === "done");
    assert.equal(doneEv, undefined, "interrupt 时不应有 done");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stream: checkpoint poll exits after bound → emit done (no infinite wait)", async () => {
  const { checkpointer, db, dir } = createTempCheckpointer();
  const threadId = "thread-cp-no-int";

  try {
    const repo = stubRepo();
    const stubAgent = {
      streamEvents: async () => {
        async function* gen() {
          yield { method: "messages", params: { data: { event: "message-start", id: "m1" } } };
        }
        const it = gen();
        (it as any).output = Promise.resolve(undefined);
        return it;
      },
    } as any;

    const runtime = new DeepAgentsRuntime(repo, {
      createLLM: () => stubAgent as any,
      createAgent: () => stubAgent as any,
      getCheckpointer: () => checkpointer,
    });

    const start = Date.now();
    const events: any[] = [];
    for await (const ev of runtime.stream("test", threadId)) {
      events.push(ev);
    }
    const elapsed = Date.now() - start;

    // 不应有 interrupt（checkpoint 中无数据）
    const interruptEv = events.find((e: any) => e.type === "interrupt");
    assert.equal(interruptEv, undefined, "无 interrupt 时不应误报");

    const doneEv = events.find((e: any) => e.type === "done");
    assert.ok(doneEv, "轮询上限后应正常结束");

    // 由于 _pollPendingInterrupt 在首次命中时就返回（checkpoint 为空，立即 null），
    // 不应有 500ms 的上限等待。如果首次命中即返回 null，elapsed 应 < 200ms
    assert.ok(
      elapsed < 1000,
      `轮询应在有界时间内退出，实际耗时 ${elapsed}ms`,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
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
    getCheckpointer: () => stubCheckpointer(),
  });
}
