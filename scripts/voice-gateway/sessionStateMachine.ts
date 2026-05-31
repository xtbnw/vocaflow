// TTS Session 状态机 — 纯逻辑，不依赖 WebSocket
// 可独立单元测试

import type { VoiceGatewayServerMessage } from "../../frontend/infrastructure/tts/voiceGatewayProtocol";
import { Event, MessageType } from "./doubaoProtocol";

export const enum SessionState {
  Idle = "idle",
  Starting = "starting",
  Active = "active",
  Finishing = "finishing",
  Cancelling = "cancelling",
}

export interface RequestTemplate {
  user: { uid: string };
  req_params: {
    speaker: string;
    model: string;
    audio_params: {
      format: string;
      sample_rate: number;
    };
  };
}

export interface SessionStateMachine {
  state: SessionState;
  activeRequestId: string | null;
  activeSessionId: string | null;
  requestTemplate: RequestTemplate | null;
}

export function createSessionState(): SessionStateMachine {
  return {
    state: SessionState.Idle,
    activeRequestId: null,
    activeSessionId: null,
    requestTemplate: null,
  };
}

export function isActive(sm: SessionStateMachine): boolean {
  return sm.state !== SessionState.Idle;
}

export function reset(sm: SessionStateMachine): void {
  sm.state = SessionState.Idle;
  sm.activeRequestId = null;
  sm.activeSessionId = null;
  sm.requestTemplate = null;
}

export interface StartResult {
  success: boolean;
  error?: VoiceGatewayServerMessage;
  sessionId?: string;
}

/** 尝试开始新 session。状态进入 starting，等待豆包 SessionStarted 后进入 active。 */
export function tryStart(
  sm: SessionStateMachine,
  requestId: string,
  sessionId: string,
  template: RequestTemplate,
): StartResult {
  if (isActive(sm)) {
    return {
      success: false,
      error: {
        type: "error",
        requestId,
        code: "SESSION_ACTIVE",
        message: "Another session is already active. Finish or cancel it first.",
      },
    };
  }
  sm.state = SessionState.Starting;
  sm.activeRequestId = requestId;
  sm.activeSessionId = sessionId;
  sm.requestTemplate = template;
  return { success: true, sessionId };
}

/** 豆包返回 SessionStarted 后，确认进入 active 状态。 */
export function confirmStarted(sm: SessionStateMachine): boolean {
  if (sm.state === SessionState.Starting) {
    sm.state = SessionState.Active;
    return true;
  }
  return false;
}

// -- 基础校验 --

function checkActiveAndRequestId(
  sm: SessionStateMachine,
  requestId: string,
): { success: false; error: VoiceGatewayServerMessage } | null {
  if (!isActive(sm)) {
    return {
      success: false,
      error: { type: "error", requestId, code: "NO_SESSION", message: "No active session. Send 'start' first." },
    };
  }
  if (sm.activeRequestId !== requestId) {
    return {
      success: false,
      error: {
        type: "error",
        requestId,
        code: "REQUEST_ID_MISMATCH",
        message: `requestId "${requestId}" does not match active session requestId.`,
      },
    };
  }
  return null;
}

export interface DeltaResult {
  success: boolean;
  error?: VoiceGatewayServerMessage;
}

export function tryTextDelta(sm: SessionStateMachine, requestId: string): DeltaResult {
  const baseCheck = checkActiveAndRequestId(sm, requestId);
  if (baseCheck) return baseCheck;

  if (sm.state !== SessionState.Active) {
    return {
      success: false,
      error: { type: "error", requestId, code: "SESSION_NOT_ACTIVE", message: `Session is ${sm.state}, cannot send text.` },
    };
  }
  return { success: true };
}

export function tryFinish(sm: SessionStateMachine, requestId: string): DeltaResult {
  const baseCheck = checkActiveAndRequestId(sm, requestId);
  if (baseCheck) return baseCheck;

  if (sm.state !== SessionState.Active) {
    return {
      success: false,
      error: { type: "error", requestId, code: "SESSION_NOT_ACTIVE", message: `Session is ${sm.state}, cannot finish.` },
    };
  }
  sm.state = SessionState.Finishing;
  return { success: true };
}

export interface CancelResult {
  success: boolean;
  error?: VoiceGatewayServerMessage;
  /** true if the gateway should send CancelSession to doubao */
  shouldSendToDoubao: boolean;
}

export function tryCancel(sm: SessionStateMachine, requestId: string): CancelResult {
  const baseCheck = checkActiveAndRequestId(sm, requestId);
  if (baseCheck) return { success: false, error: baseCheck.error, shouldSendToDoubao: false };

  // 允许在 starting / active / finishing 状态下取消
  // 已在 cancelling 状态则幂等忽略，不重复发送
  if (sm.state === SessionState.Cancelling) {
    return { success: true, shouldSendToDoubao: false };
  }

  sm.state = SessionState.Cancelling;
  return { success: true, shouldSendToDoubao: true };
}

export interface DoubaoEventResult {
  type: "ended" | "canceled" | "error" | "none";
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** 处理豆包下行事件，返回应发给浏览器的消息类型 */
export function handleDoubaoEvent(
  sm: SessionStateMachine,
  event: number,
  payloadJson?: unknown,
): DoubaoEventResult {
  switch (event) {
    case Event.SessionFinished: {
      if (sm.state === SessionState.Active || sm.state === SessionState.Finishing) {
        const requestId = sm.activeRequestId ?? undefined;
        reset(sm);
        return { type: "ended", requestId };
      }
      return { type: "none" };
    }
    case Event.SessionCanceled: {
      if (sm.state === SessionState.Cancelling) {
        const requestId = sm.activeRequestId ?? undefined;
        reset(sm);
        return { type: "canceled", requestId };
      }
      return { type: "none" };
    }
    case Event.SessionFailed: {
      const requestId = sm.activeRequestId ?? undefined;
      reset(sm);
      const msg = payloadJson && typeof payloadJson === "object"
        ? (payloadJson as Record<string, unknown>).message ?? "Session failed"
        : "Session failed";
      return { type: "error", requestId, errorCode: "SESSION_FAILED", errorMessage: String(msg) };
    }
    default:
      return { type: "none" };
  }
}

// -- 帧处理纯逻辑（可独立单元测试，不依赖 WebSocket） --

/** sessionId 需要匹配的事件 */
const SESSION_SCOPED_EVENTS = new Set<number>([
  Event.SessionStarted,
  Event.SessionFinished,
  Event.SessionCanceled,
  Event.SessionFailed,
  Event.TTSResponse,
  Event.TTSSentenceStart,
  Event.TTSSentenceEnd,
]);

export interface ProcessFrameResult {
  action: "send_ready" | "send_audio" | "send_ended" | "send_canceled" | "send_error" | "ignore";
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
  audioData?: Buffer;
}

/**
 * 处理单个豆包下行帧的完整决策逻辑（纯函数）。
 * - 先处理文本错误帧和二进制错误帧
 * - 对 session-scoped 事件校验 sessionId 隔离
 * - 委托 handleDoubaoEvent 处理 SessionFinished/Canceled/Failed
 * - 委托 confirmStarted 处理 SessionStarted
 * server.ts 只需根据返回的 action 发送 WebSocket 消息。
 */
export function processDoubaoFrame(
  sm: SessionStateMachine,
  params: {
    isTextError: boolean;
    textErrorContent?: string;
    messageType: number;
    event?: number;
    sessionId?: string;
    errorCode?: number;
    payloadJson?: unknown;
    audioData?: Buffer;
  },
): ProcessFrameResult {
  // 上游文本错误帧 → UPSTREAM_ERROR + 释放 session
  if (params.isTextError) {
    const requestId = sm.activeRequestId ?? undefined;
    reset(sm);
    return {
      action: "send_error",
      requestId,
      errorCode: "UPSTREAM_ERROR",
      errorMessage: params.textErrorContent
        ? `Doubao text error: ${params.textErrorContent}`
        : "Doubao text error",
    };
  }

  // 豆包二进制错误帧 (MessageType.Error, 无 event, 无 sessionId)
  if (params.messageType === MessageType.Error) {
    const requestId = sm.activeRequestId ?? undefined;
    reset(sm);
    const msg = params.payloadJson && typeof params.payloadJson === "object"
      ? (params.payloadJson as Record<string, unknown>).message ?? `Doubao error (code=${params.errorCode})`
      : `Doubao error (code=${params.errorCode})`;
    return { action: "send_error", requestId, errorCode: "UPSTREAM_ERROR", errorMessage: String(msg) };
  }

  const { event } = params;
  if (event == null) return { action: "ignore" };

  // sessionId 隔离：session-scoped 事件必须匹配当前活跃 sessionId
  if (SESSION_SCOPED_EVENTS.has(event) && params.sessionId !== sm.activeSessionId) {
    return { action: "ignore" };
  }

  // SessionStarted → confirmStarted + ready
  if (event === Event.SessionStarted) {
    const confirmed = confirmStarted(sm);
    if (confirmed && sm.activeRequestId) {
      return { action: "send_ready", requestId: sm.activeRequestId };
    }
    return { action: "ignore" };
  }

  // TTSResponse → 转发音频（仅在 Active 或 Finishing 状态）
  if (event === Event.TTSResponse) {
    if (
      params.audioData &&
      (sm.state === SessionState.Active || sm.state === SessionState.Finishing)
    ) {
      return { action: "send_audio", audioData: params.audioData };
    }
    return { action: "ignore" };
  }

  // TTSSentenceStart / TTSSentenceEnd → 不转发，仅忽略
  if (event === Event.TTSSentenceStart || event === Event.TTSSentenceEnd) {
    return { action: "ignore" };
  }

  // SessionFinished / SessionCanceled / SessionFailed → 委托状态机
  const result = handleDoubaoEvent(sm, event, params.payloadJson);
  switch (result.type) {
    case "ended":
      return { action: "send_ended", requestId: result.requestId };
    case "canceled":
      return { action: "send_canceled", requestId: result.requestId };
    case "error":
      return { action: "send_error", requestId: result.requestId, errorCode: result.errorCode, errorMessage: result.errorMessage };
    default:
      return { action: "ignore" };
  }
}
