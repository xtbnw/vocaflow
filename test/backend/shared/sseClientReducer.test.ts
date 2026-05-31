import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reduceStreamState,
  initialStreamState,
  isCalendarTool,
  buildDisplayMessages,
  shouldStopVoice,
  type StreamState,
  type ToolActivity,
} from "../../../frontend/hooks/useAgentSession";
import type { AgentStreamEvent } from "../../../backend/domain/agentRuntime";
import type { SessionMessage } from "../../../backend/domain/sessionTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function state(overrides?: Partial<StreamState>): StreamState {
  return { ...initialStreamState(), ...overrides };
}

// ---------------------------------------------------------------------------
// reduceStreamState — thread
// ---------------------------------------------------------------------------

test("reduceStreamState saves threadId from thread event", () => {
  const event: AgentStreamEvent = { type: "thread", threadId: "t-123" };
  const next = reduceStreamState(initialStreamState(), event);
  assert.equal(next.threadId, "t-123");
});

test("reduceStreamState overwrites previous threadId", () => {
  const event: AgentStreamEvent = { type: "thread", threadId: "t-new" };
  const next = reduceStreamState(state({ threadId: "t-old" }), event);
  assert.equal(next.threadId, "t-new");
});

// ---------------------------------------------------------------------------
// reduceStreamState — message_delta
// ---------------------------------------------------------------------------

test("message_delta creates first assistant message", () => {
  const event: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-1",
    text: "你好",
  };
  const next = reduceStreamState(initialStreamState(), event);
  assert.equal(next.messages.length, 1);
  assert.equal(next.messages[0].kind, "assistant");
  assert.equal(next.messages[0].id, "msg-1");
  assert.equal(next.messages[0].content, "你好");
});

test("message_delta appends to same messageId", () => {
  const event1: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-1",
    text: "让我",
  };
  const event2: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-1",
    text: "查询一下",
  };

  let s = reduceStreamState(initialStreamState(), event1);
  s = reduceStreamState(s, event2);

  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].content, "让我查询一下");
});

test("message_delta creates new message when messageId changes", () => {
  const event1: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-1",
    text: "让我查询。",
  };
  const event2: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-2",
    text: "明天没有安排。",
  };

  let s = reduceStreamState(initialStreamState(), event1);
  s = reduceStreamState(s, event2);

  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[0].content, "让我查询。");
  assert.equal(s.messages[1].content, "明天没有安排。");
  assert.equal(s.messages[1].id, "msg-2");
});

test("message_delta appends to correct message when multiple exist", () => {
  const s0 = state({
    messages: [
      { kind: "assistant", id: "msg-1", content: "第一段。", timestamp: "t1" },
      { kind: "assistant", id: "msg-2", content: "第二段", timestamp: "t2" },
    ],
  });

  const event: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-2",
    text: "续写。",
  };

  const next = reduceStreamState(s0, event);
  assert.equal(next.messages.length, 2);
  assert.equal(next.messages[1].content, "第二段续写。");
});

test("message_delta preserves existing user messages", () => {
  const s0 = state({
    messages: [
      { kind: "user", id: "u-1", text: "查询日程", timestamp: "t0" },
    ],
  });

  const event: AgentStreamEvent = {
    type: "message_delta",
    messageId: "msg-1",
    text: "正在查询...",
  };

  const next = reduceStreamState(s0, event);
  assert.equal(next.messages.length, 2);
  assert.equal(next.messages[0].kind, "user");
  assert.equal(next.messages[1].kind, "assistant");
});

// ---------------------------------------------------------------------------
// reduceStreamState — tool_started / tool_finished / tool_error
// ---------------------------------------------------------------------------

test("tool_started adds activity with running status", () => {
  const event: AgentStreamEvent = {
    type: "tool_started",
    callId: "call-1",
    tool: "query_events",
    arguments: { rangeStartAt: "2026-06-01T00:00:00.000Z" },
  };

  const next = reduceStreamState(initialStreamState(), event);
  assert.equal(next.toolActivities.length, 1);
  assert.equal(next.toolActivities[0].callId, "call-1");
  assert.equal(next.toolActivities[0].tool, "query_events");
  assert.equal(next.toolActivities[0].status, "running");
});

test("tool_finished updates status to completed", () => {
  const s0 = state({
    toolActivities: [
      { callId: "call-1", tool: "query_events", status: "running" as const },
    ],
  });

  const event: AgentStreamEvent = {
    type: "tool_finished",
    callId: "call-1",
    tool: "query_events",
    result: { action: "queried", events: [] },
  };

  const next = reduceStreamState(s0, event);
  assert.equal(next.toolActivities[0].status, "completed");
});

test("tool_error updates status to failed with message", () => {
  const s0 = state({
    toolActivities: [
      { callId: "call-2", tool: "query_events", status: "running" as const },
    ],
  });

  const event: AgentStreamEvent = {
    type: "tool_error",
    callId: "call-2",
    tool: "query_events",
    message: "查询超时",
  };

  const next = reduceStreamState(s0, event);
  assert.equal(next.toolActivities[0].status, "failed");
  assert.equal(next.toolActivities[0].message, "查询超时");
});

test("tool events only affect matching callId", () => {
  const s0 = state({
    toolActivities: [
      { callId: "call-a", tool: "query_events", status: "running" as const },
      { callId: "call-b", tool: "write_todos", status: "running" as const },
    ],
  });

  const event: AgentStreamEvent = {
    type: "tool_finished",
    callId: "call-a",
    tool: "query_events",
    result: {},
  };

  const next = reduceStreamState(s0, event);
  assert.equal(next.toolActivities[0].status, "completed");
  assert.equal(next.toolActivities[1].status, "running");
});

// ---------------------------------------------------------------------------
// reduceStreamState — done / error
// ---------------------------------------------------------------------------

test("done sets done flag", () => {
  const next = reduceStreamState(initialStreamState(), { type: "done" });
  assert.equal(next.done, true);
});

test("error sets error message and done flag", () => {
  const event: AgentStreamEvent = {
    type: "error",
    code: "NETWORK_ERROR",
    message: "无法连接到服务",
  };

  const next = reduceStreamState(initialStreamState(), event);
  assert.equal(next.error, "无法连接到服务");
  assert.equal(next.done, true);
});

// ---------------------------------------------------------------------------
// isCalendarTool
// ---------------------------------------------------------------------------

test("isCalendarTool returns true for create_event, query_events, delete_event", () => {
  assert.equal(isCalendarTool("create_event"), true);
  assert.equal(isCalendarTool("query_events"), true);
  assert.equal(isCalendarTool("delete_event"), true);
});

test("isCalendarTool returns false for internal deep agent tools", () => {
  assert.equal(isCalendarTool("write_todos"), false);
  assert.equal(isCalendarTool("task"), false);
  assert.equal(isCalendarTool("shell"), false);
  assert.equal(isCalendarTool(""), false);
});

// ---------------------------------------------------------------------------
// Full flow integration: text + tools + text
// ---------------------------------------------------------------------------

test("full flow: thread → deltas → tool → deltas → done", () => {
  const events: AgentStreamEvent[] = [
    { type: "thread", threadId: "t-full" },
    { type: "message_delta", messageId: "msg-1", text: "让我" },
    { type: "message_delta", messageId: "msg-1", text: "查询一下。" },
    { type: "tool_started", callId: "c-1", tool: "query_events", arguments: { rangeStartAt: "2026-06-01T00:00:00.000Z", rangeEndAt: "2026-06-02T00:00:00.000Z" } },
    { type: "tool_finished", callId: "c-1", tool: "query_events", result: { events: [] } },
    { type: "message_delta", messageId: "msg-2", text: "明天没有安排。" },
    { type: "done" },
  ];

  let s = initialStreamState();
  for (const ev of events) {
    s = reduceStreamState(s, ev);
  }

  assert.equal(s.threadId, "t-full");
  assert.equal(s.done, true);
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[0].content, "让我查询一下。");
  assert.equal(s.messages[1].content, "明天没有安排。");
  assert.equal(s.toolActivities.length, 1);
  assert.equal(s.toolActivities[0].status, "completed");
});

test("full flow with tool error", () => {
  const events: AgentStreamEvent[] = [
    { type: "thread", threadId: "t-err" },
    { type: "message_delta", messageId: "msg-1", text: "查询中..." },
    { type: "tool_started", callId: "c-1", tool: "query_events", arguments: {} },
    { type: "tool_error", callId: "c-1", tool: "query_events", message: "查询失败" },
    { type: "done" },
  ];

  let s = initialStreamState();
  for (const ev of events) {
    s = reduceStreamState(s, ev);
  }

  assert.equal(s.threadId, "t-err");
  assert.equal(s.done, true);
  assert.equal(s.error, null); // done event 不设置 error
  assert.equal(s.toolActivities.length, 1);
  assert.equal(s.toolActivities[0].status, "failed");
  assert.equal(s.toolActivities[0].message, "查询失败");
});

test("stream error sets error and done", () => {
  const events: AgentStreamEvent[] = [
    { type: "thread", threadId: "t-err2" },
    { type: "error", code: "NETWORK_ERROR", message: "网络中断" },
  ];

  let s = initialStreamState();
  for (const ev of events) {
    s = reduceStreamState(s, ev);
  }

  assert.equal(s.error, "网络中断");
  assert.equal(s.done, true);
  assert.equal(s.threadId, "t-err2");
});

// ---------------------------------------------------------------------------
// buildDisplayMessages — 多轮历史保留
// ---------------------------------------------------------------------------

function userMsg(id: string, text: string): SessionMessage {
  return { kind: "user", id, text, timestamp: new Date().toISOString() };
}

function asstMsg(id: string, content: string): SessionMessage {
  return { kind: "assistant", id, content, timestamp: new Date().toISOString() };
}

test("buildDisplayMessages composes preSubmit + optimistic + stream messages", () => {
  const preSubmit: SessionMessage[] = [userMsg("u1", "你好")];
  const optimistic: SessionMessage = userMsg("u2-opt", "再查一下");
  const stream: SessionMessage[] = [asstMsg("a2", "好的。")];

  const result = buildDisplayMessages(preSubmit, optimistic, stream);
  assert.equal(result.length, 3);
  assert.equal(result[0].id, "u1");
  assert.equal(result[1].id, "u2-opt");
  assert.equal(result[2].id, "a2");
});

test("buildDisplayMessages: two-round conversation preserves u1,a1,u2,a2 order", () => {
  // Round 1 ended — full history stored in preSubmit
  const round1: SessionMessage[] = [
    userMsg("u1", "明天有会吗？"),
    asstMsg("a1", "明天没有会议。"),
  ];

  // Round 2 starts — optimistic user message added, stream produces assistant response
  const optimisticU2: SessionMessage = userMsg("u2", "后天呢？");
  const round2Stream: SessionMessage[] = [asstMsg("a2", "后天下午 3 点有团队周会。")];

  const result = buildDisplayMessages(round1, optimisticU2, round2Stream);
  assert.equal(result.length, 4);
  assert.equal(result[0].kind, "user");
  assert.equal(result[0].id, "u1");
  assert.equal(result[1].kind, "assistant");
  assert.equal(result[1].id, "a1");
  assert.equal(result[2].kind, "user");
  assert.equal(result[2].id, "u2");
  assert.equal(result[3].kind, "assistant");
  assert.equal(result[3].id, "a2");
});

test("buildDisplayMessages: three rounds preserve full history", () => {
  const history: SessionMessage[] = [
    userMsg("u1", "你好"),
    asstMsg("a1", "你好！"),
    userMsg("u2", "帮我查日程"),
    asstMsg("a2", "明天没有安排。"),
  ];

  const optU3: SessionMessage = userMsg("u3", "好的谢谢");
  const stream3: SessionMessage[] = [asstMsg("a3", "不客气！")];

  const result = buildDisplayMessages(history, optU3, stream3);
  assert.equal(result.length, 6);
  assert.deepStrictEqual(result.map((m) => m.id), ["u1", "a1", "u2", "a2", "u3", "a3"]);
});

// ---------------------------------------------------------------------------
// Interaction tests — resume flow & submit blocking contract
// ---------------------------------------------------------------------------

test("reducer: interrupt pass-through does not set done", () => {
  const s0 = state({ threadId: "t", messages: [asstMsg("a1", "创建中...")] });
  const next = reduceStreamState(s0, {
    type: "interrupt",
    review: {
      kind: "tool_review",
      action: "create_event",
      arguments: { title: "测试" },
      preview: { title: "创建日程", summary: "", items: [] },
    },
  });
  assert.equal(next.done, false);
  assert.equal(next.error, null);
  assert.equal(next.messages.length, 1); // messages unchanged
});

test("reducer: events_changed pass-through does not set done", () => {
  const s0 = state({ done: false });
  const next = reduceStreamState(s0, { type: "events_changed" });
  assert.equal(next.done, false);
  assert.equal(next.error, null);
});

test("reducer: resume flow approve — done clears stream error-free", () => {
  // Simulate resume flow: thread → tool_started → tool_finished → events_changed → done
  const events: AgentStreamEvent[] = [
    { type: "thread", threadId: "t-resume" },
    { type: "tool_started", callId: "c1", tool: "create_event", arguments: { title: "测试" } },
    { type: "tool_finished", callId: "c1", tool: "create_event", result: { action: "created" } },
    { type: "events_changed" },
    { type: "done" },
  ];

  let s = initialStreamState();
  for (const ev of events) {
    s = reduceStreamState(s, ev);
  }

  assert.equal(s.threadId, "t-resume");
  assert.equal(s.done, true);
  assert.equal(s.error, null);
  assert.equal(s.toolActivities.length, 1);
  assert.equal(s.toolActivities[0].status, "completed");
});

test("reducer: resume flow reject — done without events_changed", () => {
  // reject: tool returns "rejected" → no events_changed emitted by runtime
  const events: AgentStreamEvent[] = [
    { type: "thread", threadId: "t-reject" },
    { type: "tool_started", callId: "c1", tool: "delete_event", arguments: { eventIds: ["e1"] } },
    { type: "tool_finished", callId: "c1", tool: "delete_event", result: { action: "rejected" } },
    { type: "done" },
  ];

  let s = initialStreamState();
  for (const ev of events) {
    s = reduceStreamState(s, ev);
  }

  assert.equal(s.done, true);
  assert.equal(s.error, null);
  assert.equal(s.toolActivities[0].status, "completed");
});

test("reducer: resume flow error — error event sets error and done", () => {
  const events: AgentStreamEvent[] = [
    { type: "thread", threadId: "t-err" },
    { type: "error", code: "TOOL_ERROR", message: "写入失败" },
  ];

  let s = initialStreamState();
  for (const ev of events) {
    s = reduceStreamState(s, ev);
  }

  assert.equal(s.done, true);
  assert.equal(s.error, "写入失败");
});

// ---------------------------------------------------------------------------
// submitText blocking contract — tests the conditions used by VoiceCommandBar
// ---------------------------------------------------------------------------

/**
 * 复现 VoiceCommandBar handleSubmit 的守卫条件，便于独立测试。
 * isSubmitting / hasPendingAction / isExecutingPending 任一为真时阻止提交。
 */
function shouldBlockSubmit(
  text: string,
  isSubmitting: boolean,
  hasPendingAction: boolean,
  isExecutingPending: boolean,
): boolean {
  return !text.trim() || isSubmitting || hasPendingAction || isExecutingPending;
}

test("submit is blocked when pendingAction exists", () => {
  assert.equal(shouldBlockSubmit("创建日程", false, true, false), true);
});

test("submit is blocked when isExecutingPending", () => {
  assert.equal(shouldBlockSubmit("创建日程", false, false, true), true);
});

test("submit is blocked when isSubmitting", () => {
  assert.equal(shouldBlockSubmit("创建日程", true, false, false), true);
});

test("submit is blocked when text is empty", () => {
  assert.equal(shouldBlockSubmit("  ", false, false, false), true);
});

test("submit is allowed when no blockers and text present", () => {
  assert.equal(shouldBlockSubmit("创建日程", false, false, false), false);
});

// ---------------------------------------------------------------------------
// shouldStopVoice — voice stop boundary contract
// ---------------------------------------------------------------------------

test("shouldStopVoice returns true when blocker appears during listening", () => {
  // pendingAction 出现 + 正在录音 → 应停止录音
  assert.equal(shouldStopVoice(true, true), true);
  // isExecutingPending + 正在录音 → 应停止录音
  assert.equal(shouldStopVoice(true, true), true);
});

test("shouldStopVoice returns false when no blocker or not listening", () => {
  // 无 blocker，正在录音 → 不应停止
  assert.equal(shouldStopVoice(false, true), false);
  // 有 blocker，但未在录音 → 无需停止
  assert.equal(shouldStopVoice(true, false), false);
  // 无 blocker 且未在录音 → 无需停止
  assert.equal(shouldStopVoice(false, false), false);
});
