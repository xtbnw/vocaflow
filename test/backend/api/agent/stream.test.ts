import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeepAgent } from "deepagents";

import { DeepAgentsRuntime } from "../../../../backend/infrastructure/agent/deepAgentsRuntime";
import { classifyStreamError } from "../../../../backend/infrastructure/agent/deepAgentsRuntime";
import { encodeSSE, sseStream } from "../../../../backend/shared/sseEncoder";
import type { AgentStreamEvent } from "../../../../backend/domain/agentRuntime";
import type { CalendarRepository } from "../../../../backend/domain/calendarRepository";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubRepo(): CalendarRepository {
  return {
    list: async () => [],
    save: async (e) => e,
    update: async (e) => e,
    delete: async () => {},
  };
}

function stubCheckpointer(): SqliteSaver {
  const db = new Database(":memory:");
  return new SqliteSaver(db);
}

interface StubAgentEventsConfig {
  /** 模拟模型输出的文本块序列 */
  textChunks?: { id: string; content: string }[];
  /** 模拟工具调用序列 */
  toolCalls?: {
    name: string;
    input: Record<string, unknown>;
    output?: unknown;
    error?: string;
  }[];
  /** 抛出异常（模拟底层错误） */
  throwError?: Error;
}

/**
 * 创建带有可控 streamEvents 的 stub agent。
 * 返回的 agent 会按顺序先发出所有 textChunks 再发出所有 toolCalls。
 */
function createStubAgent(config: StubAgentEventsConfig) {
  let seq = 0;
  const agent = {
    streamEvents: async function* (_input: unknown, _opts?: unknown) {
      const { textChunks = [], toolCalls = [], throwError } = config;

      // 为每个 textChunk 先发 message-start，再发 content-block-delta
      if (textChunks.length > 0) {
        const msgId = textChunks[0].id;
        yield {
          type: "event",
          seq: seq++,
          method: "messages",
          params: { namespace: [], timestamp: Date.now(), data: { event: "message-start", role: "ai", id: msgId } },
        };
        yield {
          type: "event",
          seq: seq++,
          method: "messages",
          params: { namespace: [], timestamp: Date.now(), data: { event: "content-block-start", index: 0, content: { type: "text", text: "" } } },
        };
        for (const chunk of textChunks) {
          yield {
            type: "event",
            seq: seq++,
            method: "messages",
            params: { namespace: [], timestamp: Date.now(), data: { event: "content-block-delta", index: 0, delta: { type: "text-delta", text: chunk.content } } },
          };
        }
      }

      // 工具执行事件通过 tools channel
      for (const tc of toolCalls) {
        const callId = `tool-run-${tc.name}`;
        yield {
          type: "event",
          seq: seq++,
          method: "tools",
          params: { namespace: [], timestamp: Date.now(), data: { event: "tool-started", tool_call_id: callId, tool_name: tc.name, input: tc.input } },
        };

        if (tc.error) {
          yield {
            type: "event",
            seq: seq++,
            method: "tools",
            params: { namespace: [], timestamp: Date.now(), data: { event: "tool-error", tool_call_id: callId, message: tc.error } },
          };
        } else {
          yield {
            type: "event",
            seq: seq++,
            method: "tools",
            params: { namespace: [], timestamp: Date.now(), data: { event: "tool-finished", tool_call_id: callId, output: tc.output } },
          };
        }
      }

      if (throwError) {
        throw throwError;
      }
    },
  };

  const streamEvents = agent.streamEvents.bind(agent);
  agent.streamEvents = (async (...args: Parameters<typeof streamEvents>) => {
    const iterator = streamEvents(...args);
    Object.defineProperty(iterator, "interrupted", { value: false });
    return iterator;
  }) as typeof agent.streamEvents;

  return agent as unknown as DeepAgent;
}

// ---------------------------------------------------------------------------
// SSE Encoder 测试
// ---------------------------------------------------------------------------

test("encodeSSE formats thread event with event: and data: lines", () => {
  const event: AgentStreamEvent = { type: "thread", threadId: "t1" };
  const encoded = encodeSSE(event);
  assert.ok(encoded.startsWith("event: thread\n"));
  assert.ok(encoded.includes("data: "));
  assert.ok(encoded.endsWith("\n\n"));
  assert.ok(encoded.includes('"threadId":"t1"'));
});

test("encodeSSE formats message_delta event", () => {
  const event: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-1",
    text: "你好",
  };
  const encoded = encodeSSE(event);
  assert.ok(encoded.startsWith("event: message_delta\n"));
  assert.ok(encoded.includes('"text":"你好"'));
  assert.ok(encoded.endsWith("\n\n"));
});

test("encodeSSE formats tool_started event", () => {
  const event: AgentStreamEvent = {
    type: "tool_started",
    callId: "call-1",
    tool: "query_events",
    arguments: { rangeStartAt: "2026-06-01T00:00:00.000Z" },
  };
  const encoded = encodeSSE(event);
  assert.ok(encoded.startsWith("event: tool_started\n"));
  assert.ok(encoded.includes('"tool":"query_events"'));
});

test("encodeSSE formats tool_finished event", () => {
  const event: AgentStreamEvent = {
    type: "tool_finished",
    callId: "call-1",
    tool: "query_events",
    result: { action: "queried", events: [] },
  };
  const encoded = encodeSSE(event);
  assert.ok(encoded.startsWith("event: tool_finished\n"));
});

test("encodeSSE formats tool_error event", () => {
  const event: AgentStreamEvent = {
    type: "tool_error",
    callId: "call-1",
    tool: "query_events",
    message: "查询超时",
  };
  const encoded = encodeSSE(event);
  assert.ok(encoded.startsWith("event: tool_error\n"));
  assert.ok(encoded.includes('"message":"查询超时"'));
});

test("encodeSSE formats done event", () => {
  const event: AgentStreamEvent = { type: "done" };
  const encoded = encodeSSE(event);
  assert.ok(encoded.startsWith("event: done\n"));
});

test("encodeSSE formats error event with code", () => {
  const event: AgentStreamEvent = {
    type: "error",
    code: "NETWORK_ERROR",
    message: "无法连接到服务",
  };
  const encoded = encodeSSE(event);
  assert.ok(encoded.startsWith("event: error\n"));
  assert.ok(encoded.includes('"code":"NETWORK_ERROR"'));
});

test("encodeSSE every event ends with double newline", () => {
  const events: AgentStreamEvent[] = [
    { type: "thread", threadId: "t1" },
    { type: "message_delta", messageId: "m1", text: "a" },
    { type: "tool_started", callId: "c1", tool: "t", arguments: {} },
    { type: "tool_finished", callId: "c1", tool: "t", result: {} },
    { type: "tool_error", callId: "c1", tool: "t", message: "e" },
    { type: "done" },
    { type: "error", code: "STREAM_ERROR", message: "e" },
  ];
  for (const ev of events) {
    const encoded = encodeSSE(ev);
    assert.ok(
      encoded.endsWith("\n\n"),
      `Event ${ev.type} should end with double newline, got: ${JSON.stringify(encoded.slice(-10))}`,
    );
  }
});

// ---------------------------------------------------------------------------
// sseStream 测试
// ---------------------------------------------------------------------------

test("sseStream converts async iterable to ReadableStream", async () => {
  async function* events(): AsyncIterable<AgentStreamEvent> {
    yield { type: "thread", threadId: "t1" };
    yield { type: "done" };
  }

  const stream = sseStream(events());
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  const chunks: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].includes("event: thread"));
  assert.ok(chunks[1].includes("event: done"));
});

test("sseStream handles empty async iterable", async () => {
  async function* events(): AsyncIterable<AgentStreamEvent> {
    // empty
  }

  const stream = sseStream(events());
  const reader = stream.getReader();

  const { value, done } = await reader.read();
  assert.equal(value, undefined);
  assert.equal(done, true);
});

// ---------------------------------------------------------------------------
// classifyStreamError 测试
// ---------------------------------------------------------------------------

test("classifyStreamError returns NETWORK_ERROR for fetch/network errors", () => {
  assert.equal(classifyStreamError(new Error("fetch failed")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("TypeError: fetch failed")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("ECONNREFUSED")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("ENOTFOUND")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("ECONNRESET")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("ETIMEDOUT")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("Connection error.")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("socket hang up")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("network timeout")), "NETWORK_ERROR");
  assert.equal(classifyStreamError(new Error("Request aborted")), "NETWORK_ERROR");
});

test("classifyStreamError: fetch failed 不误判为 MODEL_ERROR", () => {
  const code = classifyStreamError(new Error("fetch failed"));
  assert.notEqual(code, "MODEL_ERROR", "fetch failed 不应归类为模型错误");
  assert.equal(code, "NETWORK_ERROR", "fetch failed 应归类为网络错误");
});

test("classifyStreamError returns AUTH_ERROR for 401/403 errors", () => {
  assert.equal(classifyStreamError(new Error("HTTP 401 Unauthorized")), "AUTH_ERROR");
  assert.equal(classifyStreamError(new Error("403 Forbidden")), "AUTH_ERROR");
  assert.equal(classifyStreamError(new Error("invalid api key")), "AUTH_ERROR");
  assert.equal(classifyStreamError(new Error("authentication failed")), "AUTH_ERROR");
});

test("classifyStreamError returns RATE_LIMITED for 429 errors", () => {
  assert.equal(classifyStreamError(new Error("429 Too Many Requests")), "RATE_LIMITED");
  assert.equal(classifyStreamError(new Error("rate limit exceeded")), "RATE_LIMITED");
});

test("classifyStreamError returns MODEL_ERROR for schema/validation errors", () => {
  assert.equal(classifyStreamError(new Error("schema validation failed")), "MODEL_ERROR");
  assert.equal(classifyStreamError(new Error("parse error")), "MODEL_ERROR");
  assert.equal(classifyStreamError(new Error("unexpected response")), "MODEL_ERROR");
  assert.equal(classifyStreamError(new Error("did not match expected schema")), "MODEL_ERROR");
});

test("classifyStreamError returns TOOL_ERROR for tool/handler errors", () => {
  assert.equal(classifyStreamError(new Error("tool execution failed")), "TOOL_ERROR");
  assert.equal(classifyStreamError(new Error("handler error in query_events")), "TOOL_ERROR");
});

test("classifyStreamError returns STREAM_ERROR for unknown errors", () => {
  assert.equal(classifyStreamError(new Error("something else happened")), "STREAM_ERROR");
  assert.equal(classifyStreamError("not an error"), "STREAM_ERROR");
});

// ---------------------------------------------------------------------------
// DeepAgentsRuntime.stream() 事件映射测试
// ---------------------------------------------------------------------------

test("stream emits thread event as first event", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [{ id: "msg-1", content: "你好" }],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-first")) {
    collected.push(ev);
  }

  assert.equal(collected[0].type, "thread");
  assert.equal((collected[0] as { threadId: string }).threadId, "thread-first");
});

test("stream emits text deltas in correct order", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [
          { id: "msg-1", content: "你好" },
          { id: "msg-1", content: "，今天有什么安排？" },
        ],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("今天有什么安排？", "thread-delta")) {
    collected.push(ev);
  }

  const deltas = collected.filter((e) => e.type === "message_delta");
  assert.equal(deltas.length, 2);
  assert.equal((deltas[0] as { text: string }).text, "你好");
  assert.equal((deltas[1] as { text: string }).text, "，今天有什么安排？");
});

test("stream emits tool_started and tool_finished events", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [],
        toolCalls: [
          {
            name: "query_events",
            input: {
              rangeStartAt: "2026-06-01T00:00:00.000Z",
              rangeEndAt: "2026-06-02T00:00:00.000Z",
            },
            output: { action: "queried", events: [] },
          },
        ],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("查询日程", "thread-tools")) {
    collected.push(ev);
  }

  const started = collected.filter((e) => e.type === "tool_started");
  const finished = collected.filter((e) => e.type === "tool_finished");

  assert.equal(started.length, 1);
  assert.equal((started[0] as { tool: string }).tool, "query_events");
  assert.ok("callId" in started[0]);

  assert.equal(finished.length, 1);
  assert.equal((finished[0] as { tool: string }).tool, "query_events");
  assert.equal((started[0] as { callId: string }).callId, (finished[0] as { callId: string }).callId);
});

test("stream emits tool_error on handler failure", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [],
        toolCalls: [
          {
            name: "query_events",
            input: { rangeStartAt: "invalid" },
            error: "参数校验失败",
          },
        ],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("查询日程", "thread-toolerr")) {
    collected.push(ev);
  }

  const errors = collected.filter((e) => e.type === "tool_error");
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as { tool: string }).tool, "query_events");
  assert.ok((errors[0] as { message: string }).message.includes("参数校验失败"));
});

test("stream emits done after all events", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [{ id: "msg-1", content: "OK" }],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-done")) {
    collected.push(ev);
  }

  assert.equal(collected[collected.length - 1].type, "done");
});

test("stream maps network error to error event with NETWORK_ERROR code", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        throwError: new Error("fetch failed: ECONNREFUSED"),
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-net-err")) {
    collected.push(ev);
  }

  // First event is still thread
  assert.equal(collected[0].type, "thread");

  const errors = collected.filter((e) => e.type === "error");
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as { code: string }).code, "NETWORK_ERROR");
});

test("stream maps auth error to AUTH_ERROR code", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        throwError: new Error("HTTP 401 Unauthorized"),
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-auth-err")) {
    collected.push(ev);
  }

  const errors = collected.filter((e) => e.type === "error");
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as { code: string }).code, "AUTH_ERROR");
});

test("stream maps rate limit error to RATE_LIMITED code", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        throwError: new Error("429 Too Many Requests - rate limit exceeded"),
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-rate-err")) {
    collected.push(ev);
  }

  const errors = collected.filter((e) => e.type === "error");
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as { code: string }).code, "RATE_LIMITED");
});

test("stream maps model schema error to MODEL_ERROR code", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        throwError: new Error("Output did not match expected schema"),
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-model-err")) {
    collected.push(ev);
  }

  const errors = collected.filter((e) => e.type === "error");
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as { code: string }).code, "MODEL_ERROR");
});

test("stream preserves error message in error event", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        throwError: new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:443"),
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-msg")) {
    collected.push(ev);
  }

  const errors = collected.filter((e) => e.type === "error");
  assert.equal(errors.length, 1);
  const errorEvent = errors[0] as { code: string; message: string };
  assert.ok(errorEvent.message.includes("ECONNREFUSED"));
  assert.ok(errorEvent.message.includes("127.0.0.1"));
});

// ---------------------------------------------------------------------------
// 综合场景测试
// ---------------------------------------------------------------------------

test("stream handles text + tool calls in sequence", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [
          { id: "msg-1", content: "让我" },
          { id: "msg-1", content: "查询一下你的日程" },
        ],
        toolCalls: [
          {
            name: "query_events",
            input: {
              rangeStartAt: "2026-06-01T00:00:00.000Z",
              rangeEndAt: "2026-06-02T00:00:00.000Z",
            },
            output: { action: "queried", events: [{ title: "会议" }] },
          },
        ],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("查询日程", "thread-full")) {
    collected.push(ev);
  }

  const types = collected.map((e) => e.type);
  assert.deepEqual(types, [
    "thread",
    "message_delta",
    "message_delta",
    "tool_started",
    "tool_finished",
    "done",
  ]);
});

test("stream handles multiple tool calls", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [],
        toolCalls: [
          {
            name: "query_events",
            input: { rangeStartAt: "2026-06-01T00:00:00.000Z", rangeEndAt: "2026-06-02T00:00:00.000Z" },
            output: { action: "queried", events: [] },
          },
          {
            name: "query_events",
            input: { rangeStartAt: "2026-06-02T00:00:00.000Z", rangeEndAt: "2026-06-03T00:00:00.000Z", keyword: "会议" },
            output: { action: "queried", events: [{ title: "会议" }] },
          },
        ],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("查询日程", "thread-multi")) {
    collected.push(ev);
  }

  const started = collected.filter((e) => e.type === "tool_started");
  const finished = collected.filter((e) => e.type === "tool_finished");

  assert.equal(started.length, 2);
  assert.equal(finished.length, 2);

  // 验证每个 tool_start 都有对应的 tool_end（相同 callId）
  for (let i = 0; i < 2; i++) {
    assert.equal(
      (started[i] as { callId: string }).callId,
      (finished[i] as { callId: string }).callId,
    );
  }
});

test("stream emits done event even with empty agent output", async () => {
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({ textChunks: [], toolCalls: [] }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-empty-agent")) {
    collected.push(ev);
  }

  // 至少包含 thread 和 done
  const types = collected.map((e) => e.type);
  assert.deepEqual(types, ["thread", "done"]);
});

// ---------------------------------------------------------------------------
// SSE 取消传播测试
// ---------------------------------------------------------------------------

test("sseStream cancel calls iterator.return and awaits it", async () => {
  let returnCalled = false;

  const iterable: AsyncIterable<AgentStreamEvent> = {
    [Symbol.asyncIterator]() {
      let started = false;
      return {
        async next() {
          if (!started) {
            started = true;
            return { value: { type: "thread", threadId: "t1" }, done: false };
          }
          // 不会被调用（cancel 在第一帧后立即发生，pull 未再次调用）
          return new Promise(() => {});
        },
        async return() {
          returnCalled = true;
          return { value: undefined as unknown, done: true };
        },
      };
    },
  };

  const stream = sseStream(iterable);
  const reader = stream.getReader();

  const first = await reader.read();
  assert.ok(!first.done);
  const decoder = new TextDecoder();
  assert.ok(decoder.decode(first.value).includes("event: thread"));

  await reader.cancel();

  assert.equal(returnCalled, true);
});

test("async generator finally calls eventStream.abort when iterator.return is invoked", async () => {
  let abortCalled = false;
  let finallyDone = false;

  interface StreamWithAbort extends AsyncIterable<unknown> {
    abort(reason?: Error): void;
  }

  let resolvePending: ((v: IteratorResult<unknown>) => void) | null = null;

  function createAbortableStream(): StreamWithAbort {
    return {
      [Symbol.asyncIterator]() {
        let yielded = false;
        return {
          async next() {
            if (!yielded) {
              yielded = true;
              return {
                value: {
                  type: "event",
                  seq: 0,
                  method: "messages",
                  params: {
                    namespace: [],
                    timestamp: Date.now(),
                    data: { event: "message-start", role: "ai", id: "msg-1" },
                  },
                },
                done: false,
              };
            }
            return new Promise<IteratorResult<unknown>>((resolve) => {
              resolvePending = resolve;
            });
          },
          async return() {
            resolvePending?.({ value: undefined, done: true });
            return { value: undefined, done: true };
          },
        };
      },
      abort(_reason?: Error) {
        abortCalled = true;
      },
    };
  }

  async function* testGen(): AsyncIterable<AgentStreamEvent> {
    yield { type: "thread", threadId: "t" };
    let eventStream: StreamWithAbort | undefined;
    let completed = false;
    try {
      eventStream = createAbortableStream();
      for await (const _ev of eventStream) {
        yield { type: "message_delta", messageId: "x", text: "." };
      }
      completed = true;
      yield { type: "done" };
    } catch (_err) {
      // no-op
    } finally {
      finallyDone = true;
      if (!completed && eventStream && typeof eventStream.abort === "function") {
        eventStream.abort(new Error("Client disconnected"));
      }
    }
  }

  const iter = testGen()[Symbol.asyncIterator]();
  const r1 = await iter.next(); // thread
  assert.equal(r1.value.type, "thread");
  const r2 = await iter.next(); // inner event
  assert.ok(!r2.done);

  await iter.return?.();

  assert.equal(finallyDone, true);
  assert.equal(abortCalled, true);
});

// ---------------------------------------------------------------------------
// AbortController / signal 定向测试
// ---------------------------------------------------------------------------

test("AbortController.abort() immediately calls eventStream.abort()", async () => {
  let abortCalled = false;
  let resolveNext: ((v: IteratorResult<unknown>) => void) | null = null;

  const innerStream = {
    [Symbol.asyncIterator]() {
      let yielded = false;
      return {
        async next() {
          if (!yielded) {
            yielded = true;
            return {
              value: {
                type: "event", seq: 0, method: "messages",
                params: {
                  namespace: [], timestamp: Date.now(),
                  data: { event: "message-start", role: "ai", id: "msg-1" },
                },
              },
              done: false,
            };
          }
          return new Promise<IteratorResult<unknown>>((resolve) => {
            resolveNext = resolve;
          });
        },
        async return() {
          resolveNext?.({ value: undefined, done: true });
          return { value: undefined, done: true };
        },
      };
    },
    abort() {
      abortCalled = true;
      resolveNext?.({ value: undefined, done: true });
    },
  };

  const ac = new AbortController();
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      ({ streamEvents: () => innerStream } as unknown as DeepAgent),
    getCheckpointer: () => stubCheckpointer(),
  });

  const gen = runtime.stream("测试", "thread-signal", ac.signal);
  const iter = gen[Symbol.asyncIterator]();

  const r1 = await iter.next();
  assert.equal(r1.value.type, "thread");

  // 驱动 generator 进入 for-await（创建 eventStream、注册 onAbort）
  const nextPromise = iter.next();
  await new Promise((r) => setTimeout(r, 10));

  // Abort — onAbort 必须立即调用 eventStream.abort()
  ac.abort();

  const r2 = await nextPromise;
  assert.equal(r2.done, true);
  assert.equal(r2.value, undefined); // 未发送 done
  assert.equal(abortCalled, true);
});

test("abort after signal does not yield done or error", async () => {
  const ac = new AbortController();
  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      createStubAgent({
        textChunks: [{ id: "msg-1", content: "测试文本" }],
      }),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];

  const collectPromise = (async () => {
    for await (const ev of runtime.stream("测试", "thread-no-done", ac.signal)) {
      collected.push(ev);
      // 收到 thread 后立即 abort
      if (ev.type === "thread") {
        ac.abort();
      }
    }
  })();

  await collectPromise;

  // 只应有 thread 事件，没有 done 也没有 error
  assert.equal(collected.length, 1);
  assert.equal(collected[0].type, "thread");
});

test("streamEvents receives the same AbortSignal passed to stream()", async () => {
  let receivedSignal: AbortSignal | undefined;

  const ac = new AbortController();

  const runtime = new DeepAgentsRuntime(stubRepo(), {
    createLLM: () => ({ model: "mock" }) as any,
    createAgent: () =>
      ({
        streamEvents: async (_input: unknown, opts?: Record<string, unknown>) => {
          receivedSignal = (opts as any)?.signal;
          // 返回空 iterable，不访问网络
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  return { value: undefined, done: true };
                },
              };
            },
          };
        },
      } as unknown as DeepAgent),
    getCheckpointer: () => stubCheckpointer(),
  });

  const collected: AgentStreamEvent[] = [];
  for await (const ev of runtime.stream("测试", "thread-sig-pass", ac.signal)) {
    collected.push(ev);
  }

  // 验证 streamEvents 收到的 signal 与传入的是同一对象
  assert.ok(receivedSignal, "Expected streamEvents to receive a signal");
  assert.equal(receivedSignal, ac.signal);
  // 正常完成（空 iterable → done）
  assert.equal(collected[collected.length - 1].type, "done");
});

// ---------------------------------------------------------------------------
// Route 级测试 (POST / OPTIONS)
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { __overrideRuntimeForTest } from "../../../../backend/bootstrap/serverDeepAgentsRuntime";
import type { AgentRuntime } from "../../../../backend/domain/agentRuntime";

/** 创建一个最小 stub runtime，供 route 测试使用。 */
function createRouteStubRuntime(): AgentRuntime {
  return {
    kind: "stub",
    model: "stub",
    async invoke() {
      return { messages: [] };
    },
    async *stream(_message: string, threadId: string, _signal?: AbortSignal) {
      yield { type: "thread", threadId };
      yield { type: "done" };
    },
    async deleteThread() {},
  };
}

test("POST with invalid JSON returns 400", async () => {
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: "not valid json",
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
  assert.ok(body.message.includes("请求格式"));
});

test("POST with empty text returns 400", async () => {
  __overrideRuntimeForTest(createRouteStubRuntime());
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify({ text: "" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
  assert.ok(body.message.includes("请输入内容"));
});

test("POST with missing text field returns 400", async () => {
  __overrideRuntimeForTest(createRouteStubRuntime());
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify({ other: "value" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.message, "请输入内容");
});

test("POST with valid text returns 200 with text/event-stream", async () => {
  __overrideRuntimeForTest(createRouteStubRuntime());
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify({ text: "今天有什么安排？" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-store, must-revalidate");
  assert.equal(res.headers.get("Connection"), "keep-alive");
});

test("POST with valid text returns readable SSE body stream", async () => {
  __overrideRuntimeForTest(createRouteStubRuntime());
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify({ text: "测试" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);

  const body = res.body;
  assert.ok(body, "Response body should be a ReadableStream");

  const reader = body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }

  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].includes("event: thread"));
  assert.ok(chunks[chunks.length - 1].includes("event: done"));
});

test("POST preserves provided threadId in SSE stream", async () => {
  __overrideRuntimeForTest(createRouteStubRuntime());
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify({ text: "测试", threadId: "my-custom-thread" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const { value } = await reader.read();
  const chunk = decoder.decode(value!);

  assert.ok(chunk.includes('"threadId":"my-custom-thread"'));
  await reader.cancel();
});

test("POST generates new threadId when none provided", async () => {
  __overrideRuntimeForTest(createRouteStubRuntime());
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify({ text: "测试" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const { value } = await reader.read();
  const chunk = decoder.decode(value!);

  const match = chunk.match(/"threadId":"(thread-\d+-[a-z0-9]+)"/);
  assert.ok(match, `Expected generated threadId, got: ${chunk}`);
  await reader.cancel();
});

test("POST passes AbortSignal from request to runtime stream", async () => {
  let receivedSignal: AbortSignal | undefined;

  const signalTrackingStub: AgentRuntime = {
    kind: "stub",
    model: "stub",
    async invoke() {
      return { messages: [] };
    },
    async *stream(_message: string, threadId: string, signal?: AbortSignal) {
      receivedSignal = signal;
      yield { type: "thread", threadId };
      yield { type: "done" };
    },
    async deleteThread() {},
  };

  __overrideRuntimeForTest(signalTrackingStub);
  const { POST } = await import("../../../../app/api/agent/stream/route");

  const req = new NextRequest("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify({ text: "测试" }),
  });

  const res = await POST(req);

  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();

  assert.ok(receivedSignal, "Expected AbortSignal to be passed to runtime.stream");
  assert.equal(receivedSignal, req.signal);
});

test("OPTIONS returns 204 with Allow: POST, OPTIONS", async () => {
  const { OPTIONS } = await import("../../../../app/api/agent/stream/route");

  const res = await OPTIONS();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Allow"), "POST, OPTIONS");
});
