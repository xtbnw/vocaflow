import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { __overrideRuntimeForTest } from "../../../../backend/bootstrap/serverDeepAgentsRuntime";
import type { AgentRuntime } from "../../../../backend/domain/agentRuntime";

// ---------------------------------------------------------------------------
// Stub runtime
// ---------------------------------------------------------------------------

function createResumeStubRuntime(): AgentRuntime {
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
    async *resume(_decision, threadId, _signal) {
      yield { type: "thread", threadId };
      yield { type: "done" };
    },
    async deleteThread() {},
  };
}

// ---------------------------------------------------------------------------
// Validation tests
// ---------------------------------------------------------------------------

test("POST resume: invalid JSON returns 400", async () => {
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: "not valid json",
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
  assert.ok(body.message.includes("请求格式"));
});

test("POST resume: missing threadId returns 400", async () => {
  __overrideRuntimeForTest(createResumeStubRuntime());
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ decision: "approve" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
  assert.ok(body.message.includes("threadId"));
});

test("POST resume: empty threadId returns 400", async () => {
  __overrideRuntimeForTest(createResumeStubRuntime());
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ threadId: "", decision: "approve" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
  assert.ok(body.message.includes("threadId"));
});

test("POST resume: invalid decision returns 400", async () => {
  __overrideRuntimeForTest(createResumeStubRuntime());
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ threadId: "thread-1", decision: "maybe" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
  assert.ok(body.message.includes("decision"));
});

test("POST resume: missing decision returns 400", async () => {
  __overrideRuntimeForTest(createResumeStubRuntime());
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ threadId: "thread-1" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.kind, "error");
  assert.ok(body.message.includes("decision"));
});

// ---------------------------------------------------------------------------
// Happy path tests
// ---------------------------------------------------------------------------

test("POST resume: valid approve request returns 200 with SSE headers", async () => {
  __overrideRuntimeForTest(createResumeStubRuntime());
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ threadId: "thread-1", decision: "approve" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-store, must-revalidate");
  assert.equal(res.headers.get("Connection"), "keep-alive");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");
});

test("POST resume: valid reject request returns 200 SSE", async () => {
  __overrideRuntimeForTest(createResumeStubRuntime());
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ threadId: "thread-2", decision: "reject" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("Content-Type"),
    "text/event-stream; charset=utf-8",
  );
});

test("POST resume: response body contains SSE events with threadId", async () => {
  __overrideRuntimeForTest(createResumeStubRuntime());
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ threadId: "my-thread", decision: "approve" }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  assert.ok(res.body, "Expected response body");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }

  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].includes("event: thread"));
  assert.ok(chunks[0].includes('"threadId":"my-thread"'));
  assert.ok(chunks[chunks.length - 1].includes("event: done"));
});

// ---------------------------------------------------------------------------
// Signal passthrough tests
// ---------------------------------------------------------------------------

test("POST resume: passes AbortSignal from request to runtime", async () => {
  let receivedSignal: AbortSignal | undefined;

  const signalTrackingStub: AgentRuntime = {
    kind: "stub",
    model: "stub",
    async invoke() {
      return { messages: [] };
    },
    async *stream(_message, threadId, _signal) {
      yield { type: "thread", threadId };
      yield { type: "done" };
    },
    async *resume(decision, threadId, signal) {
      receivedSignal = signal;
      yield { type: "thread", threadId };
      yield { type: "done" };
    },
    async deleteThread() {},
  };

  __overrideRuntimeForTest(signalTrackingStub);
  const { POST } = await import("../../../../app/api/agent/resume/route");

  const req = new NextRequest("http://localhost/api/agent/resume", {
    method: "POST",
    body: JSON.stringify({ threadId: "thread-sig", decision: "approve" }),
  });

  const res = await POST(req);
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();

  assert.ok(receivedSignal, "Expected AbortSignal to be passed to runtime.resume");
  assert.equal(receivedSignal, req.signal);
});

// ---------------------------------------------------------------------------
// OPTIONS test
// ---------------------------------------------------------------------------

test("OPTIONS resume returns 204 with Allow header", async () => {
  const { OPTIONS } = await import("../../../../app/api/agent/resume/route");

  const res = await OPTIONS();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Allow"), "POST, OPTIONS");
});
