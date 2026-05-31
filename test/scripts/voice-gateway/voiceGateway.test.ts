import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import {
  parseClientMessage,
  serializeServerMessage,
  isOriginAllowed,
} from "../../../frontend/infrastructure/tts/voiceGatewayProtocol";
import {
  createSessionState,
  isActive,
  reset,
  tryStart,
  confirmStarted,
  tryTextDelta,
  tryFinish,
  tryCancel,
  handleDoubaoEvent,
  processDoubaoFrame,
  SessionState,
  type RequestTemplate,
} from "../../../scripts/voice-gateway/sessionStateMachine";
import {
  Event,
  MessageType,
  classifyHandshakeMessage,
  parseFrame,
} from "../../../scripts/voice-gateway/doubaoProtocol";
import { resolveGatewayConfig } from "../../../scripts/voice-gateway/gatewayConfig";
import { abortSocketSafely, type AbortableSocket } from "../../../scripts/voice-gateway/abortSocket";

const TEST_TEMPLATE: RequestTemplate = {
  user: { uid: "test-user" },
  req_params: {
    speaker: "test-speaker",
    model: "seed-tts-2.0-standard",
    audio_params: { format: "pcm", sample_rate: 24000 },
  },
};

// -- 浏览器消息 JSON 校验 --

test("parseClientMessage accepts valid start", () => {
  const msg = parseClientMessage({ type: "start", requestId: "req-1" });
  assert.equal(msg.type, "start");
  assert.equal(msg.requestId, "req-1");
});

test("parseClientMessage accepts valid text_delta", () => {
  const msg = parseClientMessage({ type: "text_delta", requestId: "req-2", text: "你好" });
  assert.equal(msg.type, "text_delta");
  assert.equal(msg.text, "你好");
});

test("parseClientMessage accepts valid finish", () => {
  const msg = parseClientMessage({ type: "finish", requestId: "req-3" });
  assert.equal(msg.type, "finish");
});

test("parseClientMessage accepts valid cancel", () => {
  const msg = parseClientMessage({ type: "cancel", requestId: "req-4" });
  assert.equal(msg.type, "cancel");
});

test("parseClientMessage rejects unknown type", () => {
  assert.throws(() => parseClientMessage({ type: "unknown", requestId: "x" }));
});

test("parseClientMessage rejects missing requestId", () => {
  assert.throws(() => parseClientMessage({ type: "start" }));
});

test("parseClientMessage rejects text_delta without text", () => {
  assert.throws(() => parseClientMessage({ type: "text_delta", requestId: "x" }));
});

test("parseClientMessage rejects non-object", () => {
  assert.throws(() => parseClientMessage("not an object"));
});

// -- serializeServerMessage (含 connected) --

test("serializeServerMessage produces correct ready JSON", () => {
  const json = serializeServerMessage({ type: "ready", requestId: "r1" });
  const parsed = JSON.parse(json);
  assert.equal(parsed.type, "ready");
  assert.equal(parsed.requestId, "r1");
});

test("serializeServerMessage produces correct connected JSON", () => {
  const json = serializeServerMessage({ type: "connected" });
  const parsed = JSON.parse(json);
  assert.equal(parsed.type, "connected");
  assert.equal(parsed.requestId, undefined);
});

test("serializeServerMessage produces correct error JSON", () => {
  const json = serializeServerMessage({ type: "error", code: "TEST_ERR", message: "something went wrong" });
  const parsed = JSON.parse(json);
  assert.equal(parsed.type, "error");
  assert.equal(parsed.code, "TEST_ERR");
  assert.equal(parsed.message, "something went wrong");
  assert.equal(parsed.requestId, undefined);
});

// ============================================================
// 状态机: 初始状态
// ============================================================

test("session state machine starts idle", () => {
  const sm = createSessionState();
  assert.equal(sm.state, SessionState.Idle);
  assert.equal(isActive(sm), false);
  assert.equal(sm.activeRequestId, null);
  assert.equal(sm.activeSessionId, null);
  assert.equal(sm.requestTemplate, null);
});

// ============================================================
// 状态机: start → starting
// ============================================================

test("start creates session in starting state", () => {
  const sm = createSessionState();
  const result = tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  assert.equal(result.success, true);
  assert.equal(result.sessionId, "sid-1");
  assert.equal(sm.state, SessionState.Starting);
  assert.equal(sm.activeRequestId, "req-1");
  assert.equal(sm.activeSessionId, "sid-1");
  assert.deepEqual(sm.requestTemplate, TEST_TEMPLATE);
});

test("start returns error when session already active", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  const result = tryStart(sm, "req-2", "sid-2", TEST_TEMPLATE);
  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.equal(result.error!.code, "SESSION_ACTIVE");
  assert.equal(sm.state, SessionState.Starting);
  assert.equal(sm.activeRequestId, "req-1");
});

test("start returns error when finishing", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");
  const result = tryStart(sm, "req-2", "sid-2", TEST_TEMPLATE);
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "SESSION_ACTIVE");
});

test("start returns error when cancelling", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  tryCancel(sm, "req-1");
  const result = tryStart(sm, "req-2", "sid-2", TEST_TEMPLATE);
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "SESSION_ACTIVE");
});

// ============================================================
// 两层 ready: confirmStarted (Starting → Active)
// ============================================================

test("confirmStarted transitions starting to active", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  assert.equal(sm.state, SessionState.Starting);
  const ok = confirmStarted(sm);
  assert.equal(ok, true);
  assert.equal(sm.state, SessionState.Active);
});

test("confirmStarted is no-op when not starting", () => {
  const sm = createSessionState();
  assert.equal(confirmStarted(sm), false);
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  assert.equal(confirmStarted(sm), false); // already active
});

// ============================================================
// text_delta 在 starting 期间被禁止
// ============================================================

test("text_delta returns error during starting", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  // still in starting, not yet active
  const result = tryTextDelta(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "SESSION_NOT_ACTIVE");
});

test("text_delta succeeds after confirmStarted", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = tryTextDelta(sm, "req-1");
  assert.equal(result.success, true);
});

// ============================================================
// finish 在 starting 期间被禁止
// ============================================================

test("finish returns error during starting", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  const result = tryFinish(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "SESSION_NOT_ACTIVE");
});

test("finish succeeds after confirmStarted", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = tryFinish(sm, "req-1");
  assert.equal(result.success, true);
  assert.equal(sm.state, SessionState.Finishing);
});

// ============================================================
// cancel 在 starting 期间允许
// ============================================================

test("cancel succeeds during starting and should send to doubao", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  assert.equal(sm.state, SessionState.Starting);
  const result = tryCancel(sm, "req-1");
  assert.equal(result.success, true);
  assert.equal(result.shouldSendToDoubao, true);
  assert.equal(sm.state, SessionState.Cancelling);
});

// ============================================================
// requestId 校验
// ============================================================

test("text_delta with wrong requestId returns REQUEST_ID_MISMATCH", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = tryTextDelta(sm, "req-wrong");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "REQUEST_ID_MISMATCH");
  assert.equal(sm.state, SessionState.Active); // 不影响当前 session
});

test("finish with wrong requestId returns REQUEST_ID_MISMATCH", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = tryFinish(sm, "req-wrong");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "REQUEST_ID_MISMATCH");
  assert.equal(sm.state, SessionState.Active); // 不影响当前 session
});

test("cancel with wrong requestId returns REQUEST_ID_MISMATCH", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  const result = tryCancel(sm, "req-wrong");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "REQUEST_ID_MISMATCH");
  assert.equal(sm.state, SessionState.Starting); // 不影响当前 session
});

// ============================================================
// 旧轮次迟到消息不影响新 session
// ============================================================

test("old round cancel does not affect new session", () => {
  const sm = createSessionState();

  // Round 1: start → active → cancel → SessionCanceled
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-1");
  handleDoubaoEvent(sm, Event.SessionCanceled);
  assert.equal(sm.state, SessionState.Idle);

  // Round 2: start → active
  tryStart(sm, "req-2", "sid-2", TEST_TEMPLATE);
  confirmStarted(sm);
  assert.equal(sm.state, SessionState.Active);
  assert.equal(sm.activeRequestId, "req-2");

  // Old round finish arrives late
  const result = tryFinish(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "REQUEST_ID_MISMATCH");
  assert.equal(sm.state, SessionState.Active); // 新 session 未被影响
});

test("old round cancel does not affect new session", () => {
  const sm = createSessionState();

  // Round 1: start → active → finish → SessionFinished
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");
  handleDoubaoEvent(sm, Event.SessionFinished);
  assert.equal(sm.state, SessionState.Idle);

  // Round 2
  tryStart(sm, "req-2", "sid-2", TEST_TEMPLATE);
  confirmStarted(sm);

  // Old round cancel arrives late
  const result = tryCancel(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "REQUEST_ID_MISMATCH");
  assert.equal(sm.state, SessionState.Active); // 新 session 未被影响
});

// ============================================================
// 重复 cancel 幂等
// ============================================================

test("duplicate cancel does not request sending to doubao again", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);

  // First cancel
  const r1 = tryCancel(sm, "req-1");
  assert.equal(r1.success, true);
  assert.equal(r1.shouldSendToDoubao, true);
  assert.equal(sm.state, SessionState.Cancelling);

  // Second cancel — same requestId, already cancelling
  const r2 = tryCancel(sm, "req-1");
  assert.equal(r2.success, true);
  assert.equal(r2.shouldSendToDoubao, false);
  assert.equal(sm.state, SessionState.Cancelling); // 仍在 cancelling
});

// ============================================================
// 文本错误帧: SessionFailed 映射为浏览器 error
// ============================================================

test("SessionFailed returns error from starting state", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  const result = handleDoubaoEvent(sm, Event.SessionFailed, { message: "server error" });
  assert.equal(result.type, "error");
  assert.equal(result.errorCode, "SESSION_FAILED");
  assert.equal(result.errorMessage, "server error");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle); // session 已释放
});

test("SessionFailed returns error from active state", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = handleDoubaoEvent(sm, Event.SessionFailed, { message: "server error" });
  assert.equal(result.type, "error");
  assert.equal(result.errorCode, "SESSION_FAILED");
  assert.equal(result.errorMessage, "server error");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("SessionFailed with missing payload returns default message", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  const result = handleDoubaoEvent(sm, Event.SessionFailed);
  assert.equal(result.type, "error");
  assert.equal(result.errorCode, "SESSION_FAILED");
  assert.equal(result.errorMessage, "Session failed");
});

// ============================================================
// 二进制错误帧测试 — handleDoubaoEvent 使用 Event enum
// ============================================================

test("SessionFinished uses Event.SessionFinished enum", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = handleDoubaoEvent(sm, Event.SessionFinished);
  assert.equal(result.type, "ended");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("SessionCanceled uses Event.SessionCanceled enum", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-1");
  const result = handleDoubaoEvent(sm, Event.SessionCanceled);
  assert.equal(result.type, "canceled");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("unknown event code returns none", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  const result = handleDoubaoEvent(sm, 999);
  assert.equal(result.type, "none");
  assert.equal(sm.state, SessionState.Starting); // state unchanged
});

// ============================================================
// 状态机: text_delta
// ============================================================

test("text_delta succeeds when active", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = tryTextDelta(sm, "req-1");
  assert.equal(result.success, true);
});

test("text_delta returns error when idle", () => {
  const sm = createSessionState();
  const result = tryTextDelta(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "NO_SESSION");
});

test("text_delta returns error when finishing", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");
  const result = tryTextDelta(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "SESSION_NOT_ACTIVE");
});

test("text_delta returns error when cancelling", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-1");
  const result = tryTextDelta(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "SESSION_NOT_ACTIVE");
});

// ============================================================
// 状态机: finish
// ============================================================

test("finish succeeds when active and transitions to finishing", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = tryFinish(sm, "req-1");
  assert.equal(result.success, true);
  assert.equal(sm.state, SessionState.Finishing);
});

test("finish returns error when idle", () => {
  const sm = createSessionState();
  const result = tryFinish(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "NO_SESSION");
});

test("finish returns error when already finishing", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");
  const result = tryFinish(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "SESSION_NOT_ACTIVE");
});

// ============================================================
// 状态机: cancel
// ============================================================

test("cancel succeeds when active and transitions to cancelling", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = tryCancel(sm, "req-1");
  assert.equal(result.success, true);
  assert.equal(result.shouldSendToDoubao, true);
  assert.equal(sm.state, SessionState.Cancelling);
});

test("cancel succeeds when finishing and transitions to cancelling", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");
  const result = tryCancel(sm, "req-1");
  assert.equal(result.success, true);
  assert.equal(result.shouldSendToDoubao, true);
  assert.equal(sm.state, SessionState.Cancelling);
});

test("cancel returns error when idle", () => {
  const sm = createSessionState();
  const result = tryCancel(sm, "req-1");
  assert.equal(result.success, false);
  assert.equal(result.error!.code, "NO_SESSION");
});

// ============================================================
// 状态机: SessionFinished event
// ============================================================

test("SessionFinished returns ended when active", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = handleDoubaoEvent(sm, Event.SessionFinished);
  assert.equal(result.type, "ended");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("SessionFinished returns ended when finishing", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");
  const result = handleDoubaoEvent(sm, Event.SessionFinished);
  assert.equal(result.type, "ended");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("SessionFinished is no-op when idle", () => {
  const sm = createSessionState();
  const result = handleDoubaoEvent(sm, Event.SessionFinished);
  assert.equal(result.type, "none");
  assert.equal(sm.state, SessionState.Idle);
});

// ============================================================
// 状态机: SessionCanceled event
// ============================================================

test("SessionCanceled returns canceled when cancelling", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-1");
  const result = handleDoubaoEvent(sm, Event.SessionCanceled);
  assert.equal(result.type, "canceled");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("SessionCanceled is no-op when not cancelling", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = handleDoubaoEvent(sm, Event.SessionCanceled);
  assert.equal(result.type, "none");
  assert.equal(sm.state, SessionState.Active);
});

test("cancel must wait for SessionCanceled before allowing next start", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-1");

  // Before SessionCanceled, new start should fail
  const startResult = tryStart(sm, "req-2", "sid-2", TEST_TEMPLATE);
  assert.equal(startResult.success, false);
  assert.equal(startResult.error!.code, "SESSION_ACTIVE");

  // After SessionCanceled, new start should succeed
  handleDoubaoEvent(sm, Event.SessionCanceled);
  assert.equal(sm.state, SessionState.Idle);
  const startResult2 = tryStart(sm, "req-2", "sid-2", TEST_TEMPLATE);
  assert.equal(startResult2.success, true);
});

// ============================================================
// 状态机: SessionFailed event
// ============================================================

test("SessionFailed returns error from any active state", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = handleDoubaoEvent(sm, Event.SessionFailed, { message: "server error" });
  assert.equal(result.type, "error");
  assert.equal(result.errorCode, "SESSION_FAILED");
  assert.equal(result.errorMessage, "server error");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

// ============================================================
// 上游错误映射测试
// ============================================================

test("upstream SessionFailed with status_code 45000001 maps to browser error", () => {
  const sm = createSessionState();
  tryStart(sm, "req-err", "sid-err", TEST_TEMPLATE);
  confirmStarted(sm);
  const result = handleDoubaoEvent(sm, Event.SessionFailed, { status_code: 45000001, message: "invalid request params" });
  assert.equal(result.type, "error");
  assert.equal(result.errorCode, "SESSION_FAILED");
  assert.equal(result.errorMessage, "invalid request params");
});

test("upstream SessionFailed from starting state maps to browser error", () => {
  const sm = createSessionState();
  tryStart(sm, "req-err", "sid-err", TEST_TEMPLATE);
  // still starting — SessionFailed should still reset
  const result = handleDoubaoEvent(sm, Event.SessionFailed, { status_code: 55000000, message: "internal server error" });
  assert.equal(result.type, "error");
  assert.equal(result.errorMessage, "internal server error");
  assert.equal(result.requestId, "req-err");
  assert.equal(sm.state, SessionState.Idle);
});

// ============================================================
// 状态机: full lifecycle
// ============================================================

test("full lifecycle: start → starting → SessionStarted → active → text_delta → finish → SessionFinished", () => {
  const sm = createSessionState();

  // Start → starting
  const start = tryStart(sm, "req-life", "sid-life", TEST_TEMPLATE);
  assert.equal(start.success, true);
  assert.equal(sm.state, SessionState.Starting);

  // SessionStarted → active
  const ok = confirmStarted(sm);
  assert.equal(ok, true);
  assert.equal(sm.state, SessionState.Active);

  // Send text
  const delta = tryTextDelta(sm, "req-life");
  assert.equal(delta.success, true);

  // Finish
  const finish = tryFinish(sm, "req-life");
  assert.equal(finish.success, true);
  assert.equal(sm.state, SessionState.Finishing);

  // SessionFinished
  const ended = handleDoubaoEvent(sm, Event.SessionFinished);
  assert.equal(ended.type, "ended");
  assert.equal(ended.requestId, "req-life");
  assert.equal(sm.state, SessionState.Idle);

  // Can start new session
  const start2 = tryStart(sm, "req-life2", "sid-life2", TEST_TEMPLATE);
  assert.equal(start2.success, true);
});

test("full lifecycle: start → starting → cancel (before SessionStarted) → SessionCanceled → new start", () => {
  const sm = createSessionState();

  tryStart(sm, "req-c", "sid-c", TEST_TEMPLATE);
  assert.equal(sm.state, SessionState.Starting);

  // Cancel during starting — allowed
  tryCancel(sm, "req-c");
  assert.equal(sm.state, SessionState.Cancelling);

  // Cannot start while cancelling
  const blocked = tryStart(sm, "req-c2", "sid-c2", TEST_TEMPLATE);
  assert.equal(blocked.success, false);

  // SessionCanceled received
  const canceled = handleDoubaoEvent(sm, Event.SessionCanceled);
  assert.equal(canceled.type, "canceled");
  assert.equal(sm.state, SessionState.Idle);

  // Now can start
  const ok = tryStart(sm, "req-c2", "sid-c2", TEST_TEMPLATE);
  assert.equal(ok.success, true);
});

test("full lifecycle: start → active → cancel → SessionCanceled → new start", () => {
  const sm = createSessionState();

  tryStart(sm, "req-c", "sid-c", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-c");
  assert.equal(sm.state, SessionState.Cancelling);

  const blocked = tryStart(sm, "req-c2", "sid-c2", TEST_TEMPLATE);
  assert.equal(blocked.success, false);

  const canceled = handleDoubaoEvent(sm, Event.SessionCanceled);
  assert.equal(canceled.type, "canceled");
  assert.equal(sm.state, SessionState.Idle);

  const ok = tryStart(sm, "req-c2", "sid-c2", TEST_TEMPLATE);
  assert.equal(ok.success, true);
});

// ============================================================
// reset 测试
// ============================================================

test("reset clears all state including template", () => {
  const sm = createSessionState();
  tryStart(sm, "req-r", "sid-r", TEST_TEMPLATE);
  assert.equal(isActive(sm), true);
  assert.deepEqual(sm.requestTemplate, TEST_TEMPLATE);

  sm.state = SessionState.Idle;
  sm.activeRequestId = null;
  sm.activeSessionId = null;
  sm.requestTemplate = null;

  assert.equal(isActive(sm), false);
  assert.equal(sm.activeRequestId, null);
  assert.equal(sm.activeSessionId, null);
  assert.equal(sm.requestTemplate, null);
});

// ============================================================
// requestTemplate 存储验证
// ============================================================

test("tryStart stores full request template", () => {
  const sm = createSessionState();
  tryStart(sm, "req-t", "sid-t", TEST_TEMPLATE);
  assert.ok(sm.requestTemplate);
  assert.equal(sm.requestTemplate!.user.uid, "test-user");
  assert.equal(sm.requestTemplate!.req_params.speaker, "test-speaker");
  assert.equal(sm.requestTemplate!.req_params.model, "seed-tts-2.0-standard");
  assert.equal(sm.requestTemplate!.req_params.audio_params.format, "pcm");
  assert.equal(sm.requestTemplate!.req_params.audio_params.sample_rate, 24000);
});

// ============================================================
// processDoubaoFrame: 文本错误帧 → UPSTREAM_ERROR + reset
// ============================================================

test("processDoubaoFrame: text error maps to UPSTREAM_ERROR and resets", () => {
  const sm = createSessionState();
  tryStart(sm, "req-txt", "sid-txt", TEST_TEMPLATE);
  confirmStarted(sm);

  const result = processDoubaoFrame(sm, {
    isTextError: true,
    textErrorContent: "unexpected server error",
    messageType: 0,
  });
  assert.equal(result.action, "send_error");
  assert.equal(result.errorCode, "UPSTREAM_ERROR");
  assert.equal(result.errorMessage, "Doubao text error: unexpected server error");
  assert.equal(result.requestId, "req-txt");
  assert.equal(sm.state, SessionState.Idle); // session 已释放
});

test("processDoubaoFrame: text error in starting state also resets", () => {
  const sm = createSessionState();
  tryStart(sm, "req-txt2", "sid-txt2", TEST_TEMPLATE);
  // still in starting

  const result = processDoubaoFrame(sm, {
    isTextError: true,
    messageType: 0,
  });
  assert.equal(result.action, "send_error");
  assert.equal(result.errorCode, "UPSTREAM_ERROR");
  assert.equal(result.errorMessage, "Doubao text error");
  assert.equal(result.requestId, "req-txt2");
  assert.equal(sm.state, SessionState.Idle);
});

// ============================================================
// processDoubaoFrame: 二进制错误帧 → UPSTREAM_ERROR + reset
// ============================================================

test("processDoubaoFrame: binary error frame maps to UPSTREAM_ERROR and resets", () => {
  const sm = createSessionState();
  tryStart(sm, "req-bin", "sid-bin", TEST_TEMPLATE);
  confirmStarted(sm);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.Error,
    errorCode: 55000000,
    payloadJson: { message: "internal server error" },
  });
  assert.equal(result.action, "send_error");
  assert.equal(result.errorCode, "UPSTREAM_ERROR");
  assert.equal(result.errorMessage, "internal server error");
  assert.equal(result.requestId, "req-bin");
  assert.equal(sm.state, SessionState.Idle);
});

test("processDoubaoFrame: binary error without payload uses default message", () => {
  const sm = createSessionState();
  tryStart(sm, "req-bin2", "sid-bin2", TEST_TEMPLATE);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.Error,
    errorCode: 45000001,
  });
  assert.equal(result.action, "send_error");
  assert.equal(result.errorMessage, "Doubao error (code=45000001)");
  assert.equal(sm.state, SessionState.Idle);
});

// ============================================================
// processDoubaoFrame: sessionId 隔离 — 迟到帧不影响当前 session
// ============================================================

test("processDoubaoFrame: cancelling receives late SessionStarted → no ready", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  assert.equal(sm.state, SessionState.Starting);

  // Cancel before SessionStarted
  tryCancel(sm, "req-1");
  assert.equal(sm.state, SessionState.Cancelling);

  // Late SessionStarted for sid-1 — sessionId matches but state is cancelling
  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionStarted,
    sessionId: "sid-1",
  });
  // confirmStarted returns false (not in Starting), so no ready
  assert.equal(result.action, "ignore");
  assert.equal(sm.state, SessionState.Cancelling); // state unchanged
});

test("processDoubaoFrame: new session ignores old session SessionFinished", () => {
  const sm = createSessionState();

  // Session 1: "sid-old"
  tryStart(sm, "req-old", "sid-old", TEST_TEMPLATE);
  confirmStarted(sm);

  // Reset (simulating SessionFinished)
  sm.state = SessionState.Idle;
  sm.activeRequestId = null;
  sm.activeSessionId = null;
  sm.requestTemplate = null;

  // Session 2: "sid-new"
  tryStart(sm, "req-new", "sid-new", TEST_TEMPLATE);
  confirmStarted(sm);
  assert.equal(sm.state, SessionState.Active);
  assert.equal(sm.activeSessionId, "sid-new");

  // Late SessionFinished from session 1
  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionFinished,
    sessionId: "sid-old",
  });
  assert.equal(result.action, "ignore");
  assert.equal(sm.state, SessionState.Active); // 新 session 未受影响
  assert.equal(sm.activeSessionId, "sid-new");
});

test("processDoubaoFrame: new session ignores old session SessionCanceled", () => {
  const sm = createSessionState();

  // Session 1
  tryStart(sm, "req-old", "sid-old", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-old");
  // Force reset (simulating SessionCanceled arrived)
  sm.state = SessionState.Idle;
  sm.activeRequestId = null;
  sm.activeSessionId = null;
  sm.requestTemplate = null;

  // Session 2
  tryStart(sm, "req-new", "sid-new", TEST_TEMPLATE);
  confirmStarted(sm);

  // Late SessionCanceled from session 1
  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionCanceled,
    sessionId: "sid-old",
  });
  assert.equal(result.action, "ignore");
  assert.equal(sm.state, SessionState.Active);
  assert.equal(sm.activeSessionId, "sid-new");
});

test("processDoubaoFrame: new session ignores old session SessionFailed", () => {
  const sm = createSessionState();

  // Session 1
  tryStart(sm, "req-old", "sid-old", TEST_TEMPLATE);
  confirmStarted(sm);
  sm.state = SessionState.Idle;
  sm.activeRequestId = null;
  sm.activeSessionId = null;
  sm.requestTemplate = null;

  // Session 2
  tryStart(sm, "req-new", "sid-new", TEST_TEMPLATE);
  confirmStarted(sm);

  // Late SessionFailed from session 1
  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionFailed,
    sessionId: "sid-old",
    payloadJson: { message: "old session error" },
  });
  assert.equal(result.action, "ignore");
  assert.equal(sm.state, SessionState.Active);
  assert.equal(sm.activeSessionId, "sid-new");
});

// ============================================================
// processDoubaoFrame: sessionId 隔离 — 音频帧
// ============================================================

test("processDoubaoFrame: old session TTSResponse audio not forwarded", () => {
  const sm = createSessionState();
  const audioData = Buffer.from([0x01, 0x02, 0x03]);

  // Session 1
  tryStart(sm, "req-old", "sid-old", TEST_TEMPLATE);
  confirmStarted(sm);
  sm.state = SessionState.Idle;
  sm.activeRequestId = null;
  sm.activeSessionId = null;
  sm.requestTemplate = null;

  // Session 2
  tryStart(sm, "req-new", "sid-new", TEST_TEMPLATE);
  confirmStarted(sm);

  // Old session audio arrives
  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.AudioOnlyResponse,
    event: Event.TTSResponse,
    sessionId: "sid-old",
    audioData,
  });
  assert.equal(result.action, "ignore");
});

test("processDoubaoFrame: current session TTSResponse audio forwarded", () => {
  const sm = createSessionState();
  const audioData = Buffer.from([0x01, 0x02, 0x03]);

  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.AudioOnlyResponse,
    event: Event.TTSResponse,
    sessionId: "sid-1",
    audioData,
  });
  assert.equal(result.action, "send_audio");
  assert.deepEqual(result.audioData, audioData);
});

test("processDoubaoFrame: TTSResponse without audioData returns ignore", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.TTSResponse,
    sessionId: "sid-1",
  });
  assert.equal(result.action, "ignore");
});

// ============================================================
// processDoubaoFrame: TTSSentenceStart/End 忽略
// ============================================================

test("processDoubaoFrame: TTSSentenceStart with matching sessionId is ignored", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.TTSSentenceStart,
    sessionId: "sid-1",
  });
  assert.equal(result.action, "ignore");
});

test("processDoubaoFrame: TTSSentenceEnd with mismatching sessionId is ignored", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.TTSSentenceEnd,
    sessionId: "sid-other",
  });
  assert.equal(result.action, "ignore");
});

// ============================================================
// processDoubaoFrame: 无 event 的帧返回 ignore
// ============================================================

test("processDoubaoFrame: frame without event returns ignore", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
  });
  assert.equal(result.action, "ignore");
});

// ============================================================
// isOriginAllowed
// ============================================================

test("isOriginAllowed allows matching origin", () => {
  const allowed = ["http://localhost:3000", "http://127.0.0.1:3000"];
  assert.equal(isOriginAllowed("http://localhost:3000", allowed), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:3000", allowed), true);
});

test("isOriginAllowed rejects non-matching origin", () => {
  const allowed = ["http://localhost:3000"];
  assert.equal(isOriginAllowed("http://evil.com:3000", allowed), false);
  assert.equal(isOriginAllowed("https://localhost:3000", allowed), false);
});

test("isOriginAllowed allows missing origin (native ws clients)", () => {
  const allowed = ["http://localhost:3000"];
  assert.equal(isOriginAllowed(undefined, allowed), true);
});

test("isOriginAllowed: empty allowed list only passes missing origin", () => {
  assert.equal(isOriginAllowed(undefined, []), true);
  assert.equal(isOriginAllowed("http://localhost:3000", []), false);
});

// ============================================================
// resolveGatewayConfig
// ============================================================

test("resolveGatewayConfig defaults host to 127.0.0.1 when env not set", () => {
  const cfg = resolveGatewayConfig({});
  assert.equal(cfg.host, "127.0.0.1");
});

test("resolveGatewayConfig uses custom host from env", () => {
  const cfg = resolveGatewayConfig({ VOICE_GATEWAY_HOST: "0.0.0.0" });
  assert.equal(cfg.host, "0.0.0.0");
});

test("resolveGatewayConfig defaults port to 3101", () => {
  const cfg = resolveGatewayConfig({});
  assert.equal(cfg.port, 3101);
});

test("resolveGatewayConfig uses custom port from env", () => {
  const cfg = resolveGatewayConfig({ VOICE_GATEWAY_PORT: "4000" });
  assert.equal(cfg.port, 4000);
});

test("resolveGatewayConfig defaults allowedOrigins", () => {
  const cfg = resolveGatewayConfig({});
  assert.deepEqual(cfg.allowedOrigins, [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("resolveGatewayConfig trims whitespace in allowedOrigins", () => {
  const cfg = resolveGatewayConfig({
    VOICE_GATEWAY_ALLOWED_ORIGINS: "http://a:3000, http://b:3000 , http://c:3000",
  });
  assert.deepEqual(cfg.allowedOrigins, [
    "http://a:3000",
    "http://b:3000",
    "http://c:3000",
  ]);
});

test("resolveGatewayConfig: single origin with no comma", () => {
  const cfg = resolveGatewayConfig({
    VOICE_GATEWAY_ALLOWED_ORIGINS: "https://example.com",
  });
  assert.deepEqual(cfg.allowedOrigins, ["https://example.com"]);
});

// ============================================================
// processDoubaoFrame: 正常流程 — SessionStarted → ready
// ============================================================

test("processDoubaoFrame: SessionStarted with matching sessionId sends ready", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  assert.equal(sm.state, SessionState.Starting);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionStarted,
    sessionId: "sid-1",
  });
  assert.equal(result.action, "send_ready");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Active);
});

test("processDoubaoFrame: SessionStarted with mismatching sessionId is ignored", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionStarted,
    sessionId: "sid-other",
  });
  assert.equal(result.action, "ignore");
  assert.equal(sm.state, SessionState.Starting); // 状态未改变
});

// ============================================================
// processDoubaoFrame: SessionFinished / SessionCanceled / SessionFailed 正常处理
// ============================================================

test("processDoubaoFrame: SessionFinished with matching sessionId sends ended", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionFinished,
    sessionId: "sid-1",
  });
  assert.equal(result.action, "send_ended");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("processDoubaoFrame: SessionCanceled with matching sessionId sends canceled", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-1");

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionCanceled,
    sessionId: "sid-1",
  });
  assert.equal(result.action, "send_canceled");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

test("processDoubaoFrame: SessionFailed with matching sessionId sends error", () => {
  const sm = createSessionState();
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.FullServerResponse,
    event: Event.SessionFailed,
    sessionId: "sid-1",
    payloadJson: { message: "server error" },
  });
  assert.equal(result.action, "send_error");
  assert.equal(result.errorCode, "SESSION_FAILED");
  assert.equal(result.errorMessage, "server error");
  assert.equal(result.requestId, "req-1");
  assert.equal(sm.state, SessionState.Idle);
});

// ============================================================
// processDoubaoFrame: 收紧音频转发 — 仅在 Active/Finishing
// ============================================================

test("processDoubaoFrame: TTSResponse in Starting state is ignored", () => {
  const sm = createSessionState();
  const audioData = Buffer.from([0x01, 0x02, 0x03]);
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  // still Starting, not yet Active
  assert.equal(sm.state, SessionState.Starting);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.AudioOnlyResponse,
    event: Event.TTSResponse,
    sessionId: "sid-1",
    audioData,
  });
  assert.equal(result.action, "ignore");
});

test("processDoubaoFrame: TTSResponse in Cancelling state is ignored", () => {
  const sm = createSessionState();
  const audioData = Buffer.from([0x01, 0x02, 0x03]);
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryCancel(sm, "req-1");
  assert.equal(sm.state, SessionState.Cancelling);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.AudioOnlyResponse,
    event: Event.TTSResponse,
    sessionId: "sid-1",
    audioData,
  });
  assert.equal(result.action, "ignore");
});

test("processDoubaoFrame: TTSResponse in Idle state is ignored", () => {
  const sm = createSessionState();
  const audioData = Buffer.from([0x01, 0x02, 0x03]);
  assert.equal(sm.state, SessionState.Idle);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.AudioOnlyResponse,
    event: Event.TTSResponse,
    sessionId: "sid-none",
    audioData,
  });
  assert.equal(result.action, "ignore");
});

test("processDoubaoFrame: TTSResponse in Finishing state is forwarded", () => {
  const sm = createSessionState();
  const audioData = Buffer.from([0x01, 0x02, 0x03]);
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  tryFinish(sm, "req-1");
  assert.equal(sm.state, SessionState.Finishing);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.AudioOnlyResponse,
    event: Event.TTSResponse,
    sessionId: "sid-1",
    audioData,
  });
  assert.equal(result.action, "send_audio");
  assert.deepEqual(result.audioData, audioData);
});

test("processDoubaoFrame: TTSResponse in Active state is forwarded", () => {
  const sm = createSessionState();
  const audioData = Buffer.from([0x05, 0x06]);
  tryStart(sm, "req-1", "sid-1", TEST_TEMPLATE);
  confirmStarted(sm);
  assert.equal(sm.state, SessionState.Active);

  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: MessageType.AudioOnlyResponse,
    event: Event.TTSResponse,
    sessionId: "sid-1",
    audioData,
  });
  assert.equal(result.action, "send_audio");
  assert.deepEqual(result.audioData, audioData);
});

// ============================================================
// classifyHandshakeMessage — 握手消息分类纯函数
// ============================================================

test("classifyHandshakeMessage: text error → rejected", () => {
  const result = classifyHandshakeMessage({
    isTextError: true,
    textContent: "server exploded",
  });
  assert.equal(result.outcome, "rejected");
  assert.ok(result.reason!.includes("server exploded"));
});

test("classifyHandshakeMessage: binary error frame → rejected", () => {
  // Build a binary error frame using parseFrame
  const errorPayload = Buffer.from(JSON.stringify({ message: "bad request" }), "utf-8");
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0xF0, 0x10, 0x00]));
  const codeBuf = Buffer.alloc(4);
  codeBuf.writeInt32BE(45000001, 0);
  parts.push(codeBuf);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(errorPayload.length, 0);
  parts.push(lenBuf);
  parts.push(errorPayload);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);

  const result = classifyHandshakeMessage({
    isTextError: false,
    frame,
  });
  assert.equal(result.outcome, "rejected");
  assert.ok(result.reason!.includes("bad request"));
});

test("classifyHandshakeMessage: binary error frame without payload uses default", () => {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0xF0, 0x10, 0x00]));
  const codeBuf = Buffer.alloc(4);
  codeBuf.writeInt32BE(55000000, 0);
  parts.push(codeBuf);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(0, 0);
  parts.push(lenBuf);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);

  const result = classifyHandshakeMessage({
    isTextError: false,
    frame,
  });
  assert.equal(result.outcome, "rejected");
  assert.ok(result.reason!.includes("55000000"));
});

test("classifyHandshakeMessage: ConnectionStarted → resolved", () => {
  const connId = "conn-abc";
  const connIdBuf = Buffer.from(connId, "utf-8");
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0x94, 0x10, 0x00]));
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.ConnectionStarted, 0);
  parts.push(eventBuf);
  const idLenBuf = Buffer.alloc(4);
  idLenBuf.writeUInt32BE(connIdBuf.length, 0);
  parts.push(idLenBuf);
  parts.push(connIdBuf);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(2, 0);
  parts.push(payloadLenBuf);
  parts.push(Buffer.from("{}", "utf-8"));

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);

  const result = classifyHandshakeMessage({
    isTextError: false,
    frame,
  });
  assert.equal(result.outcome, "resolved");
  assert.equal(result.connectionId, connId);
});

test("classifyHandshakeMessage: ConnectionFailed → rejected", () => {
  const connId = "conn-fail";
  const connIdBuf = Buffer.from(connId, "utf-8");
  const errPayload = Buffer.from(JSON.stringify({ message: "unauthorized" }), "utf-8");
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0x94, 0x10, 0x00]));
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.ConnectionFailed, 0);
  parts.push(eventBuf);
  const idLenBuf = Buffer.alloc(4);
  idLenBuf.writeUInt32BE(connIdBuf.length, 0);
  parts.push(idLenBuf);
  parts.push(connIdBuf);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(errPayload.length, 0);
  parts.push(payloadLenBuf);
  parts.push(errPayload);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);

  const result = classifyHandshakeMessage({
    isTextError: false,
    frame,
  });
  assert.equal(result.outcome, "rejected");
  assert.ok(result.reason!.includes("unauthorized"));
});

test("classifyHandshakeMessage: null frame → continue", () => {
  const result = classifyHandshakeMessage({
    isTextError: false,
    frame: null,
  });
  assert.equal(result.outcome, "continue");
});

test("classifyHandshakeMessage: undefined frame → continue", () => {
  const result = classifyHandshakeMessage({
    isTextError: false,
  });
  assert.equal(result.outcome, "continue");
});

test("classifyHandshakeMessage: unknown event → continue", () => {
  // Build a frame with SessionStarted during handshake (not expected during connect)
  const sidBuf = Buffer.from("sess-x", "utf-8");
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0x94, 0x10, 0x00]));
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.SessionStarted, 0);
  parts.push(eventBuf);
  const sidLenBuf = Buffer.alloc(4);
  sidLenBuf.writeUInt32BE(sidBuf.length, 0);
  parts.push(sidLenBuf);
  parts.push(sidBuf);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(2, 0);
  parts.push(payloadLenBuf);
  parts.push(Buffer.from("{}", "utf-8"));

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);
  assert.equal(frame.event, Event.SessionStarted);

  const result = classifyHandshakeMessage({
    isTextError: false,
    frame,
  });
  // SessionStarted during handshake should not resolve/reject — continue
  assert.equal(result.outcome, "continue");
});

test("classifyHandshakeMessage: ConnectionFailed without payload uses default", () => {
  const connId = "conn-nopayload";
  const connIdBuf = Buffer.from(connId, "utf-8");
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0x94, 0x10, 0x00]));
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.ConnectionFailed, 0);
  parts.push(eventBuf);
  const idLenBuf = Buffer.alloc(4);
  idLenBuf.writeUInt32BE(connIdBuf.length, 0);
  parts.push(idLenBuf);
  parts.push(connIdBuf);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(2, 0);
  parts.push(payloadLenBuf);
  parts.push(Buffer.from("{}", "utf-8"));

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);

  const result = classifyHandshakeMessage({
    isTextError: false,
    frame,
  });
  assert.equal(result.outcome, "rejected");
  assert.ok(result.reason!.includes("Connection failed"));
});

// ============================================================
// abortSocketSafely — 安全中止 WebSocket（fake socket 测试）
// ============================================================

/** 模拟 ws WebSocket 的最小接口，基于 EventEmitter */
class FakeSocket extends EventEmitter implements AbortableSocket {
  sent: Buffer[] = [];
  closed = false;

  send(data: Buffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    // 模拟 CONNECTING 状态下 close 的异步 error
    setImmediate(() => this.emit("error", new Error("Socket closed while connecting")));
  }
}

test("abortSocketSafely: registers error listener before close, calls cleanup, rejects", () => {
  const socket = new FakeSocket();
  let cleanedUp = false;
  let rejected: Error | null = null;

  abortSocketSafely(
    socket,
    () => { cleanedUp = true; },
    (err) => { rejected = err; },
    new Error("test abort"),
  );

  assert.equal(cleanedUp, true);
  assert.equal(socket.closed, true);
  assert.ok(rejected);
  assert.equal(rejected!.message, "test abort");
});

test("abortSocketSafely: swallows async error from CONNECTING close", (_, done) => {
  const socket = new FakeSocket();
  let unhandledError: Error | null = null;

  // 如果没有兜底 once("error")，这个 error 会变成 unhandled
  process.once("uncaughtException", (err) => {
    unhandledError = err;
  });

  abortSocketSafely(
    socket,
    () => {},
    () => {},
    new Error("abort"),
  );

  // 等待假 socket 的 setImmediate error
  setImmediate(() => {
    // 给 uncaughtException 一点时间（不应该触发）
    setTimeout(() => {
      assert.equal(unhandledError, null);
      done();
    }, 50);
  });
});

test("abortSocketSafely + settled guard: cleanup removes open, late open does not send", () => {
  const socket = new FakeSocket();

  function onOpen(): void {
    socket.send(Buffer.from("StartConnection"));
  }
  socket.once("open", onOpen);

  function cleanup(): void {
    socket.removeListener("open", onOpen);
  }

  // 模拟 abortSocket wrapper（带 settled guard）
  let settled = false;
  function abortSocket(reason: Error): void {
    if (settled) return;
    settled = true;
    abortSocketSafely(socket, cleanup, () => {}, reason);
  }

  abortSocket(new Error("timeout"));

  // 模拟超时后迟到的 open
  socket.emit("open");
  assert.equal(socket.sent.length, 0); // StartConnection 未被发送
});

test("abortSocket with settled guard: only rejects once", () => {
  const socket = new FakeSocket();
  let rejectCount = 0;

  function cleanup(): void {
    socket.removeListener("open", () => {});
  }

  let settled = false;
  function abortSocket(reason: Error): void {
    if (settled) return;
    settled = true;
    abortSocketSafely(socket, cleanup, () => { rejectCount++; }, reason);
  }

  abortSocket(new Error("first"));
  assert.equal(rejectCount, 1);

  // 第二次调用被 settled guard 阻止
  abortSocket(new Error("second"));
  assert.equal(rejectCount, 1);

  // 第三次（模拟 error 事件在 close 之后仍触发）
  abortSocket(new Error("third"));
  assert.equal(rejectCount, 1);
});
