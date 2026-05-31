import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { streamMessage } from "../../../frontend/api/agentClient";
import type { AgentStreamEvent } from "../../../backend/domain/agentRuntime";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

let capturedInit: RequestInit | undefined;
let originalFetch: typeof globalThis.fetch;

function sseText(events: AgentStreamEvent[]): string {
  return events
    .map((e) => {
      const data = JSON.stringify(e);
      return `event: ${e.type}\ndata: ${data}\n\n`;
    })
    .join("");
}

function mockFetchSSE(events: AgentStreamEvent[], opts?: { status?: number; chunkEvery?: number; errorMessage?: string }) {
  const status = opts?.status ?? 200;
  const chunkEvery = opts?.chunkEvery ?? 0; // 0 = single chunk
  const errorMessage = opts?.errorMessage;

  originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: RequestInfo, init?: RequestInit) => {
    capturedInit = init;

    if (status !== 200) {
      return new Response(
        JSON.stringify({ message: errorMessage ?? "请求失败" }),
        { status, headers: { "Content-Type": "application/json" } },
      );
    }

    const encoder = new TextEncoder();
    const raw = encoder.encode(sseText(events));

    const chunks: Uint8Array[] = [];
    if (chunkEvery > 0) {
      for (let i = 0; i < raw.length; i += chunkEvery) {
        chunks.push(raw.slice(i, i + chunkEvery));
      }
    } else {
      chunks.push(raw);
    }

    let idx = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (idx < chunks.length) {
          controller.enqueue(chunks[idx++]);
        } else {
          controller.close();
        }
      },
    });

    return new Response(stream, { status: 200 });
  }) as typeof globalThis.fetch;
}

function mockFetchNetworkError(message: string) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error(message);
  }) as typeof globalThis.fetch;
}

function restoreFetch() {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
}

beforeEach(() => {
  capturedInit = undefined;
});

afterEach(() => {
  restoreFetch();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("streamMessage triggers onEvent for each SSE event in order", async () => {
  mockFetchSSE([
    { type: "thread", threadId: "t1" },
    { type: "message_delta", messageId: "m1", text: "你好" },
    { type: "done" },
  ]);

  const events: AgentStreamEvent[] = [];
  await streamMessage("测试", null, (e) => events.push(e));

  assert.equal(events.length, 3);
  assert.equal(events[0].type, "thread");
  assert.equal(events[1].type, "message_delta");
  assert.equal(events[2].type, "done");
});

test("streamMessage cross-chunk SSE parsing: events split across chunks", async () => {
  // Split every 7 bytes to force cross-chunk boundaries within event lines
  mockFetchSSE(
    [
      { type: "thread", threadId: "cross-chunk" },
      { type: "message_delta", messageId: "m1", text: "hello" },
      { type: "done" },
    ],
    { chunkEvery: 7 },
  );

  const events: AgentStreamEvent[] = [];
  await streamMessage("测试", null, (e) => events.push(e));

  assert.equal(events.length, 3);
  assert.equal(events[0].type, "thread");
  assert.equal((events[0] as { threadId: string }).threadId, "cross-chunk");
  assert.equal(events[1].type, "message_delta");
  assert.equal((events[1] as { text: string }).text, "hello");
  assert.equal(events[2].type, "done");
});

test("streamMessage multiple events in correct order", async () => {
  mockFetchSSE([
    { type: "thread", threadId: "t-order" },
    { type: "message_delta", messageId: "m1", text: "first" },
    { type: "tool_started", callId: "c1", tool: "query_events", arguments: {} },
    { type: "tool_finished", callId: "c1", tool: "query_events", result: { events: [] } },
    { type: "message_delta", messageId: "m2", text: "second" },
    { type: "done" },
  ]);

  const types: string[] = [];
  await streamMessage("测试", null, (e) => types.push(e.type));

  assert.deepStrictEqual(types, [
    "thread",
    "message_delta",
    "tool_started",
    "tool_finished",
    "message_delta",
    "done",
  ]);
});

test("streamMessage passes signal to fetch", async () => {
  mockFetchSSE([
    { type: "thread", threadId: "t-sig" },
    { type: "done" },
  ]);

  const controller = new AbortController();
  await streamMessage("测试", null, () => {}, controller.signal);

  assert.ok(capturedInit, "Expected fetch to be called with init");
  assert.equal(capturedInit!.signal, controller.signal);
});

test("streamMessage throws on non-2xx response with error message", async () => {
  mockFetchSSE([], { status: 500, errorMessage: "内部服务错误" });

  await assert.rejects(
    streamMessage("测试", null, () => {}),
    (err: Error) => err.message === "内部服务错误",
  );
});

test("streamMessage throws on 400 with default message when body has no message field", async () => {
  mockFetchSSE([], { status: 400, errorMessage: undefined });

  await assert.rejects(
    streamMessage("测试", null, () => {}),
    (err: Error) => err.message === "请求失败",
  );
});

test("streamMessage throws on empty response body", async () => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    capturedInit = undefined;
    return new Response(null, { status: 200 });
  }) as typeof globalThis.fetch;

  await assert.rejects(
    streamMessage("测试", null, () => {}),
    (err: Error) => err.message === "响应体为空",
  );
});

test("streamMessage handles AbortError from fetch without throwing", async () => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: RequestInfo, init?: RequestInit) => {
    capturedInit = init;
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  }) as typeof globalThis.fetch;

  const controller = new AbortController();
  controller.abort();

  await assert.doesNotReject(
    streamMessage("测试", null, () => {}, controller.signal),
  );
});

test("streamMessage handles AbortError from reader.read without throwing", async () => {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  const firstChunk = encoder.encode(
    `event: thread\ndata: ${JSON.stringify({ type: "thread", threadId: "t-read-abort" })}\n\n`,
  );

  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const stream = new ReadableStream({
      start(streamController) {
        streamController.enqueue(firstChunk);
      },
      pull(streamController) {
        // 第二次 reader.read() 触发 pull，注入 AbortError
        const err = new Error("aborted");
        err.name = "AbortError";
        streamController.error(err);
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof globalThis.fetch;

  const events: AgentStreamEvent[] = [];
  // fetch succeeds; first read returns chunk, second read rejects with AbortError
  await assert.doesNotReject(
    streamMessage("测试", null, (e) => events.push(e), controller.signal),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "thread");
});

test("streamMessage ignores corrupt JSON lines without breaking stream", async () => {
  // Manually construct a Response with a corrupt SSE line between valid events
  originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const valid1 = encoder.encode(`event: thread\ndata: {"type":"thread","threadId":"t-corr"}\n\n`);
  const corrupt = encoder.encode(`data: not-valid-json\n\n`);
  const valid2 = encoder.encode(`event: done\ndata: {"type":"done"}\n\n`);

  const chunks = [valid1, corrupt, valid2];
  let idx = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(chunks[idx++]);
      } else {
        controller.close();
      }
    },
  });

  globalThis.fetch = (async () => {
    capturedInit = undefined;
    return new Response(stream, { status: 200 });
  }) as typeof globalThis.fetch;

  const events: AgentStreamEvent[] = [];
  await streamMessage("测试", null, (e) => events.push(e));

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "thread");
  assert.equal((events[0] as { threadId: string }).threadId, "t-corr");
  assert.equal(events[1].type, "done");
});
