import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  DeepAgentsRuntime,
  createQueryEventsTool,
  DEFAULT_LLM_CONFIG,
} from "../../../../backend/infrastructure/agent/deepAgentsRuntime";
import type { CalendarRepository } from "../../../../backend/domain/calendarRepository";
import type { CalendarEvent } from "../../../../backend/domain/calendarTypes";
import { QueryEventsArgsSchema } from "../../../../backend/domain/calendarTypes";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import type { CheckpointMetadata } from "@langchain/langgraph-checkpoint";
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

  // 断言只有一个业务工具
  assert.equal(capturedTools.length, 1);
  assert.equal(capturedTools[0].name, "query_events");

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
