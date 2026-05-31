/**
 * Deep Agents 真实 LLM 集成测试。
 *
 * 需要有效的 DEEPSEEK_API_KEY 环境变量（自动从 .env.local 加载）。
 * 缺少 API Key 时使用 node:test skip 跳过；网络不可达时报告环境阻塞。
 *
 * 运行方式：npm run test:integration
 */

import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

// 从项目根目录的 .env.local 加载环境变量
(function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local 不存在，使用外部注入的环境变量
  }
})();

import { DeepAgentsRuntime } from "../../backend/infrastructure/agent/deepAgentsRuntime";
import type { CalendarEvent } from "../../backend/domain/calendarTypes";
import {
  createTempFixture,
  cleanupFixture,
  collectStream,
  collectResume,
  makeDeleteRepo,
  requireApiKey,
} from "./helper";
import type { TempFixture } from "./helper";

// ---------------------------------------------------------------------------
// 环境检查
// ---------------------------------------------------------------------------

test("环境检查：DEEPSEEK_API_KEY 已配置", () => {
  const key = process.env.DEEPSEEK_API_KEY;
  assert.ok(key, "缺少 DEEPSEEK_API_KEY 环境变量");
  assert.ok(key.startsWith("sk-"), "DEEPSEEK_API_KEY 应以 sk- 开头");
  assert.ok(key.length >= 30, "DEEPSEEK_API_KEY 长度不足");
});

// ---------------------------------------------------------------------------
// helper 自身行为验证（不需要真实 API Key）
// ---------------------------------------------------------------------------

test("helper: 短超时假流不会挂起且返回 NETWORK_ERROR", async () => {
  const db = new Database(":memory:");
  const checkpointer = new SqliteSaver(db);

  // 创建一个等待 abort 的 stub agent，模拟可取消的 LLM 挂起请求
  const stubAgent = {
    streamEvents: async () => {
      let finish: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => { finish = resolve; });
      const iterator = {
        async next() {
          await pending;
          return { done: true, value: undefined };
        },
        async return() {
          finish?.();
          return { done: true, value: undefined };
        },
        async abort() {
          finish?.();
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return iterator;
    },
  } as any;

  const runtime = new DeepAgentsRuntime(
    {
      list: async () => [],
      save: async (e) => e as any,
      update: async (e) => e as any,
      delete: async () => {},
    },
    {
      createLLM: () => stubAgent as any,
      createAgent: () => stubAgent as any,
      getCheckpointer: () => checkpointer,
    },
  );

  const start = Date.now();
  const result = await collectStream(runtime, "test", "thread-short-timeout", 500);
  const elapsed = Date.now() - start;

  assert.ok(result.hasError, "短超时后应有错误");
  assert.equal(result.errorCode, "NETWORK_ERROR");
  assert.ok(
    result.errorMessage!.includes("timed out"),
    `错误消息应包含 timed out，实际: ${result.errorMessage}`,
  );
  assert.ok(elapsed < 2000, `不应挂起，实际耗时 ${elapsed}ms`);

  db.close();
});

// =============================================================================
// 基础 tool-calling 验收（绝对时间，强制工具调用指令）
// =============================================================================

test("验收：create_event 绝对时间触发 interrupt", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const result = await collectStream(
      runtime,
      "创建日程：标题项目评审，开始时间 2026-06-15T15:00:00+08:00，结束时间 2026-06-15T16:00:00+08:00。请立即调用 create_event。",
      "int-create-abs-interrupt",
    );

    if (result.hasError) {
      assert.fail(`环境阻塞: [${result.errorCode}] ${result.errorMessage}`);
    }

    assert.ok(
      result.toolsStarted.includes("create_event"),
      `期望调用 create_event 工具，实际调用: [${result.toolsStarted.join(", ") || "无"}]，回复: ${result.fullText.slice(0, 200)}`,
    );
    assert.ok(result.hasInterrupt, "期望创建日程触发 interrupt");
    assert.equal(result.interruptAction, "create_event");
    assert.equal(result.hasDone, false, "interrupt 时不应有 done 事件");
    assert.equal(f.saved.length, 0, "审批前不应写入数据");
    console.log(`[interrupt] action=${result.interruptAction}`);
  } finally {
    cleanupFixture(f);
  }
});

test("验收：create_event approve 后写入", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const threadId = "int-create-abs-approve";

    const step1 = await collectStream(
      runtime,
      "创建日程：标题周会，开始时间 2026-06-16T10:00:00+08:00，结束时间 2026-06-16T11:00:00+08:00。请立即调用 create_event。",
      threadId,
    );

    if (step1.hasError) {
      assert.fail(`环境阻塞: [${step1.errorCode}] ${step1.errorMessage}`);
    }

    assert.ok(
      step1.toolsStarted.includes("create_event"),
      `Step1: 期望调用 create_event，实际: [${step1.toolsStarted.join(", ") || "无"}]，回复: ${step1.fullText.slice(0, 200)}`,
    );
    assert.ok(step1.hasInterrupt, "Step1: 期望 interrupt");
    assert.equal(f.saved.length, 0, "Step1: 审批前不应写入");

    const step2Events = await collectResume(runtime, "approve", threadId);

    const step2HasError = step2Events.some((e) => e.type === "error");
    if (step2HasError) {
      const errEv = step2Events.find((e) => e.type === "error") as { code: string; message: string };
      assert.fail(`环境阻塞: [${errEv.code}] ${errEv.message}`);
    }

    assert.ok(f.saved.length >= 1, "Step2: approve 后应写入日程");
    const created = f.saved.find((e) => e.title.includes("周会"));
    assert.ok(created, "应能通过标题找到创建的日程");
    console.log(`[approve] created: ${created!.title}`);
  } finally {
    cleanupFixture(f);
  }
});

test("验收：create_event reject 后不写入", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const threadId = "int-create-abs-reject";

    const step1 = await collectStream(
      runtime,
      "创建日程：标题聚餐，开始时间 2026-06-17T18:00:00+08:00，结束时间 2026-06-17T20:00:00+08:00。请立即调用 create_event。",
      threadId,
    );

    if (step1.hasError) {
      assert.fail(`环境阻塞: [${step1.errorCode}] ${step1.errorMessage}`);
    }

    assert.ok(
      step1.toolsStarted.includes("create_event"),
      `Step1: 期望调用 create_event，实际: [${step1.toolsStarted.join(", ") || "无"}]，回复: ${step1.fullText.slice(0, 200)}`,
    );
    assert.ok(step1.hasInterrupt, "Step1: 期望 interrupt");

    await collectResume(runtime, "reject", threadId);

    assert.equal(f.saved.length, 0, "reject 后不应写入任何日程");
    console.log("[reject] 正确拒绝创建，无数据写入");
  } finally {
    cleanupFixture(f);
  }
});

test("验收：delete_event 指定 eventId 触发 interrupt", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const existingEvent: CalendarEvent = {
      id: "evt-del-abs-1",
      title: "要删除的会议",
      startAt: "2026-06-15T14:00:00.000Z",
      endAt: "2026-06-15T15:00:00.000Z",
      source: "text",
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:00:00.000Z",
    };
    f.repo = makeDeleteRepo(existingEvent, f.deleted);

    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const result = await collectStream(
      runtime,
      "删除 eventId 为 evt-del-abs-1 的日程，请立即调用 delete_event。",
      "int-delete-abs-interrupt",
    );

    if (result.hasError) {
      assert.fail(`环境阻塞: [${result.errorCode}] ${result.errorMessage}`);
    }

    assert.ok(
      result.toolsStarted.includes("delete_event"),
      `期望调用 delete_event 工具，实际调用: [${result.toolsStarted.join(", ") || "无"}]，回复: ${result.fullText.slice(0, 200)}`,
    );
    assert.ok(result.hasInterrupt, "期望删除日程触发 interrupt");
    assert.equal(result.interruptAction, "delete_event");
    assert.equal(f.deleted.length, 0, "审批前不应删除数据");
    console.log(`[interrupt] delete action=${result.interruptAction}`);
  } finally {
    cleanupFixture(f);
  }
});

test("验收：delete_event approve 后删除", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const existingEvent: CalendarEvent = {
      id: "evt-del-abs-approve",
      title: "要审批删除的会议",
      startAt: "2026-06-20T10:00:00.000Z",
      endAt: "2026-06-20T11:00:00.000Z",
      source: "text",
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:00:00.000Z",
    };
    f.repo = makeDeleteRepo(existingEvent, f.deleted);

    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const threadId = "int-delete-abs-approve";

    const step1 = await collectStream(
      runtime,
      "删除 eventId 为 evt-del-abs-approve 的日程，请立即调用 delete_event。",
      threadId,
    );

    if (step1.hasError) {
      assert.fail(`环境阻塞: [${step1.errorCode}] ${step1.errorMessage}`);
    }

    assert.ok(
      step1.toolsStarted.includes("delete_event"),
      `Step1: 期望调用 delete_event，实际: [${step1.toolsStarted.join(", ") || "无"}]，回复: ${step1.fullText.slice(0, 200)}`,
    );
    assert.ok(step1.hasInterrupt, "Step1: 期望 interrupt");
    assert.equal(step1.interruptAction, "delete_event");

    const step2Events = await collectResume(runtime, "approve", threadId);

    const step2HasError = step2Events.some((e) => e.type === "error");
    if (step2HasError) {
      const errEv = step2Events.find((e) => e.type === "error") as { code: string; message: string };
      assert.fail(`环境阻塞: [${errEv.code}] ${errEv.message}`);
    }

    assert.equal(f.deleted.length, 1, "approve 后应删除恰好 1 个日程");
    assert.ok(f.deleted.includes("evt-del-abs-approve"), "应删除目标日程");
    console.log("[delete approve] 删除成功");
  } finally {
    cleanupFixture(f);
  }
});

test("验收：delete_event reject 后不删除", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const existingEvent: CalendarEvent = {
      id: "evt-del-abs-reject",
      title: "要拒绝删除的日程",
      startAt: "2026-06-25T14:00:00.000Z",
      endAt: "2026-06-25T15:00:00.000Z",
      source: "text",
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:00:00.000Z",
    };
    f.repo = makeDeleteRepo(existingEvent, f.deleted);

    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const threadId = "int-delete-abs-reject";

    const step1 = await collectStream(
      runtime,
      "删除 eventId 为 evt-del-abs-reject 的日程，请立即调用 delete_event。",
      threadId,
    );

    if (step1.hasError) {
      assert.fail(`环境阻塞: [${step1.errorCode}] ${step1.errorMessage}`);
    }

    assert.ok(
      step1.toolsStarted.includes("delete_event"),
      `Step1: 期望调用 delete_event，实际: [${step1.toolsStarted.join(", ") || "无"}]，回复: ${step1.fullText.slice(0, 200)}`,
    );
    assert.ok(step1.hasInterrupt, "Step1: 期望 interrupt");
    assert.equal(step1.interruptAction, "delete_event");

    await collectResume(runtime, "reject", threadId);

    assert.equal(f.deleted.length, 0, "reject 后不应删除任何日程");
    console.log("[delete reject] 正确拒绝删除，无数据丢失");
  } finally {
    cleanupFixture(f);
  }
});

// ---------------------------------------------------------------------------
// 验收：查询日程
// ---------------------------------------------------------------------------

test("验收：查询空日程列表返回自然语言回复", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const result = await collectStream(runtime, "今天有什么安排？", "int-query-empty");

    if (result.hasError) {
      assert.fail(`环境阻塞: [${result.errorCode}] ${result.errorMessage}`);
    }

    assert.ok(result.messages.length > 0, "期望至少一条文本回复");
    assert.ok(result.hasDone, "期望流正常结束");
    const fullText = result.messages.join("");
    console.log(`[LLM回复] ${fullText.slice(0, 200)}`);
    assert.ok(fullText.length > 0, "回复内容不应为空");
  } finally {
    cleanupFixture(f);
  }
});

// ---------------------------------------------------------------------------
// 验收：多轮上下文
// ---------------------------------------------------------------------------

test("验收：同一 threadId 多轮上下文延续，回复包含'张三'", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const threadId = "int-multiturn";

    const r1 = await collectStream(runtime, "我叫张三", threadId);
    if (r1.hasError) {
      assert.fail(`环境阻塞: [${r1.errorCode}] ${r1.errorMessage}`);
    }
    assert.ok(r1.hasDone, "Round1: 期望正常结束");

    const r2 = await collectStream(runtime, "我叫什么名字？", threadId);
    if (r2.hasError) {
      assert.fail(`环境阻塞: [${r2.errorCode}] ${r2.errorMessage}`);
    }
    assert.ok(r2.hasDone, "Round2: 期望正常结束");

    const fullText = r2.messages.join("");
    console.log(`[多轮round2] ${fullText.slice(0, 300)}`);
    assert.ok(
      fullText.includes("张三"),
      `多轮回复应包含"张三"，实际回复: ${fullText.slice(0, 200)}`,
    );
  } finally {
    cleanupFixture(f);
  }
});

test("验收：不同 threadId 间上下文隔离，不包含'李四'", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const rA = await collectStream(runtime, "我叫李四", "int-thread-a");
    if (rA.hasError) {
      assert.fail(`环境阻塞: [${rA.errorCode}] ${rA.errorMessage}`);
    }

    const rB = await collectStream(runtime, "我叫什么名字？", "int-thread-b");
    if (rB.hasError) {
      assert.fail(`环境阻塞: [${rB.errorCode}] ${rB.errorMessage}`);
    }

    const textB = rB.messages.join("");
    console.log(`[隔离测试 threadB] ${textB.slice(0, 300)}`);
    assert.ok(
      !textB.includes("李四"),
      `Thread B 不应知道 Thread A 的上下文，但回复中包含"李四": ${textB.slice(0, 200)}`,
    );
  } finally {
    cleanupFixture(f);
  }
});

// ---------------------------------------------------------------------------
// deleteThread 生命周期
// ---------------------------------------------------------------------------

test("验收：deleteThread 后 threadId checkpoint 不存在", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const threadId = "int-deletethread";

    const r1 = await collectStream(runtime, "你好", threadId);
    if (r1.hasError) {
      assert.fail(`环境阻塞: [${r1.errorCode}] ${r1.errorMessage}`);
    }
    assert.ok(r1.hasDone, "Round1: 期望正常结束");

    await runtime.deleteThread(threadId);

    const tuple = await (f.checkpointer as SqliteSaver).getTuple({
      configurable: { thread_id: threadId },
    });
    assert.equal(tuple, undefined, "deleteThread 后 checkpoint 应不存在");
    console.log("[deleteThread] checkpoint 已正确清除");
  } finally {
    cleanupFixture(f);
  }
});

// =============================================================================
// 产品行为诊断（相对时间、多步规划 — 仅观察记录，不断言通过）
// =============================================================================

test("诊断：相对时间创建日程的 LLM 行为", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const result = await collectStream(
      runtime,
      "帮我创建一个明天下午3点的会议，标题是快速评审",
      "diag-create-relative",
    );

    console.log(`[诊断-相对时间创建] 调用的工具: [${result.toolsStarted.join(", ") || "无"}]`);
    console.log(`[诊断-相对时间创建] interrupt: ${result.hasInterrupt} (${result.interruptAction ?? "N/A"})`);
    console.log(`[诊断-相对时间创建] LLM回复: ${result.fullText.slice(0, 300)}`);

    if (result.hasError) {
      console.log(`[诊断-相对时间创建] 错误: [${result.errorCode}] ${result.errorMessage}`);
    }

    if (!result.toolsStarted.includes("create_event")) {
      console.log("[诊断-相对时间创建] 注意：模型未调用 create_event 工具，以文本回复代替（已知 deepseek-v4-pro 行为特征）");
    }
  } finally {
    cleanupFixture(f);
  }
});

test("诊断：按标题删除（多步规划 query_events → delete_event）的 LLM 行为", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const existingEvent: CalendarEvent = {
      id: "evt-diag-title-del",
      title: "诊断删除测试会议",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-01T10:00:00.000Z",
      source: "text",
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:00:00.000Z",
    };
    f.repo = makeDeleteRepo(existingEvent, f.deleted);

    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const result = await collectStream(
      runtime,
      "帮我删除诊断删除测试会议",
      "diag-title-delete",
    );

    console.log(`[诊断-按标题删除] 调用的工具: [${result.toolsStarted.join(", ") || "无"}]`);
    console.log(`[诊断-按标题删除] interrupt: ${result.hasInterrupt} (${result.interruptAction ?? "N/A"})`);
    console.log(`[诊断-按标题删除] LLM回复: ${result.fullText.slice(0, 300)}`);

    if (result.hasError) {
      console.log(`[诊断-按标题删除] 错误: [${result.errorCode}] ${result.errorMessage}`);
    }

    // 多步规划诊断：期望链为 query_events → delete_event
    if (result.toolsStarted.includes("query_events")) {
      console.log("[诊断-按标题删除] 模型正确先查询了日程");
    }
    if (result.toolsStarted.includes("delete_event")) {
      console.log("[诊断-按标题删除] 模型调用了 delete_event");
    }
    if (!result.toolsStarted.includes("query_events") && !result.toolsStarted.includes("delete_event")) {
      console.log("[诊断-按标题删除] 注意：模型未按多步规划执行，以文本回复代替（已知 deepseek-v4-pro 行为特征）");
    }
  } finally {
    cleanupFixture(f);
  }
});

test("诊断：相对时间查询的 LLM 行为", async (t) => {
  if (!requireApiKey(t)) return;
  const f = createTempFixture();
  try {
    const runtime = new DeepAgentsRuntime(f.repo, {
      getCheckpointer: () => f.checkpointer,
    });

    const result = await collectStream(
      runtime,
      "下周一下午有什么安排？",
      "diag-query-relative",
    );

    console.log(`[诊断-相对时间查询] 调用的工具: [${result.toolsStarted.join(", ") || "无"}]`);
    console.log(`[诊断-相对时间查询] LLM回复: ${result.fullText.slice(0, 300)}`);

    if (result.hasError) {
      console.log(`[诊断-相对时间查询] 错误: [${result.errorCode}] ${result.errorMessage}`);
    }
  } finally {
    cleanupFixture(f);
  }
});
