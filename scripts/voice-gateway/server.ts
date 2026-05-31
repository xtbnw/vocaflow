// 豆包双向流式 TTS WebSocket 网关
// 浏览器连接本地网关 → 网关代理豆包 TTS 上游连接
// 豆包鉴权信息仅存服务端，不下发浏览器

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import {
  Event,
  MessageType,
  classifyHandshakeMessage,
  encodeStartConnection,
  encodeStartSession,
  encodeFinishSession,
  encodeCancelSession,
  encodeTaskRequest,
  parseFrame,
  eventName,
  type ParsedFrame,
} from "./doubaoProtocol";
import {
  createSessionState,
  isActive,
  reset,
  tryStart,
  tryTextDelta,
  tryFinish,
  tryCancel,
  processDoubaoFrame,
  type SessionStateMachine,
  type RequestTemplate,
} from "./sessionStateMachine";
import {
  parseClientMessage,
  serializeServerMessage,
  isOriginAllowed,
  type VoiceGatewayServerMessage,
} from "../../frontend/infrastructure/tts/voiceGatewayProtocol";
import { resolveGatewayConfig } from "./gatewayConfig";
import { abortSocketSafely } from "./abortSocket";

// -- 配置 --

const VOLCENGINE_API_KEY = process.env.VOLCENGINE_TTS_API_KEY;
const VOLCENGINE_SPEAKER = process.env.VOLCENGINE_TTS_SPEAKER;
const VOLCENGINE_RESOURCE_ID = process.env.VOLCENGINE_TTS_RESOURCE_ID ?? "seed-tts-2.0";
const GATEWAY_CFG = resolveGatewayConfig(process.env);
const GATEWAY_HOST = GATEWAY_CFG.host;
const GATEWAY_PORT = GATEWAY_CFG.port;
const ALLOWED_ORIGINS = GATEWAY_CFG.allowedOrigins;

const DOUBAO_WS_URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection";

// -- 日志 --

const SENSITIVE_RE = /(X-Api-Key[=:]\s*)[^\s,;"')\]]+/gi;

function log(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const line = JSON.stringify({ timestamp, level, msg, ...extra });
  const safe = line.replace(SENSITIVE_RE, "$1***");
  if (level === "error") {
    process.stderr.write(safe + "\n");
  } else {
    process.stdout.write(safe + "\n");
  }
}

function maskKey(key: string | undefined): string {
  if (!key) return "<not set>";
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}

// -- 帮助函数 --

function sendServerMessage(ws: WebSocket, msg: VoiceGatewayServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(serializeServerMessage(msg));
  }
}

function buildRequestTemplate(): RequestTemplate {
  return {
    user: { uid: "vocaflow" },
    req_params: {
      speaker: VOLCENGINE_SPEAKER!,
      model: "seed-tts-2.0-standard",
      audio_params: { format: "pcm", sample_rate: 24000 },
    },
  };
}

// -- Doubao 连接管理 --

interface DoubaoConnection {
  socket: WebSocket;
  connectionId?: string;
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

function connectDoubao(): Promise<DoubaoConnection> {
  if (!VOLCENGINE_API_KEY) {
    return Promise.reject(new Error("VOLCENGINE_TTS_API_KEY is not set"));
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DOUBAO_WS_URL, {
      headers: {
        "X-Api-Key": VOLCENGINE_API_KEY,
        "X-Api-Resource-Id": VOLCENGINE_RESOURCE_ID,
      },
    });

    const conn: DoubaoConnection = { socket };
    let settled = false;

    const timeout = setTimeout(() => {
      abortSocket(new Error(`Doubao handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
    }, HANDSHAKE_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timeout);
      socket.removeListener("open", onOpen);
      socket.removeListener("message", onMessage);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    }

    function abortSocket(reason: Error): void {
      if (settled) return;
      settled = true;
      abortSocketSafely(socket, cleanup, reject, reason);
    }

    function safeResolve(value: DoubaoConnection): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    const onOpen = (): void => {
      socket.send(encodeStartConnection());
    };

    const onMessage = (data: Buffer, isBinary: boolean): void => {
      const textContent = isBinary ? undefined : data.toString("utf-8");
      const frame = isBinary ? parseFrame(data) : null;

      const classification = classifyHandshakeMessage({
        isTextError: !isBinary,
        textContent,
        frame,
      });

      if (classification.outcome === "resolved") {
        conn.connectionId = classification.connectionId;
        safeResolve(conn);
      } else if (classification.outcome === "rejected") {
        log("error", "Doubao handshake rejected", { reason: classification.reason });
        abortSocket(new Error(classification.reason!));
      }
      // "continue" → 继续等待
    };

    const onError = (err: Error): void => {
      abortSocket(new Error(`Doubao WebSocket error: ${err.message}`));
    };

    const onClose = (code: number): void => {
      abortSocket(new Error(`Doubao WebSocket closed before connection started (code=${code})`));
    };

    socket.once("open", onOpen);
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

// -- Doubao 帧处理 --

/** 将 processDoubaoFrame 的纯逻辑结果转换为 WebSocket 消息发送 */
function applyFrameResult(
  ws: WebSocket,
  result: ReturnType<typeof processDoubaoFrame>,
): void {
  switch (result.action) {
    case "send_ready":
      if (result.requestId) sendServerMessage(ws, { type: "ready", requestId: result.requestId });
      break;
    case "send_audio":
      if (result.audioData && ws.readyState === WebSocket.OPEN) {
        ws.send(result.audioData);
      }
      break;
    case "send_ended":
      if (result.requestId) sendServerMessage(ws, { type: "ended", requestId: result.requestId });
      break;
    case "send_canceled":
      if (result.requestId) sendServerMessage(ws, { type: "canceled", requestId: result.requestId });
      break;
    case "send_error":
      sendServerMessage(ws, {
        type: "error",
        requestId: result.requestId,
        code: result.errorCode ?? "UPSTREAM_ERROR",
        message: result.errorMessage ?? "Unknown error",
      });
      break;
    case "ignore":
      break;
  }
}

function handleDoubaoFrame(
  sm: SessionStateMachine,
  ws: WebSocket,
  frame: ParsedFrame,
): void {
  const result = processDoubaoFrame(sm, {
    isTextError: false,
    messageType: frame.messageType,
    event: frame.event,
    sessionId: frame.sessionId,
    errorCode: frame.errorCode,
    payloadJson: frame.payloadJson,
    audioData: frame.audioData,
  });

  // 日志记录
  if (result.action === "send_ready") {
    log("info", "Session started", { sessionId: frame.sessionId });
  } else if (result.action === "send_ended") {
    log("info", "Session finished", { sessionId: frame.sessionId });
  } else if (result.action === "send_canceled") {
    log("info", "Session canceled", { sessionId: frame.sessionId });
  } else if (result.action === "send_error") {
    log("error", "Doubao upstream error", {
      sessionId: frame.sessionId,
      errorCode: frame.errorCode,
      payload: frame.payloadJson,
    });
  }

  applyFrameResult(ws, result);
}

// -- 浏览器消息处理 --

function handleClientMessage(
  sm: SessionStateMachine,
  ws: WebSocket,
  doubaoSocket: WebSocket,
  raw: Buffer,
): void {
  let msg: ReturnType<typeof parseClientMessage>;
  try {
    msg = parseClientMessage(JSON.parse(raw.toString("utf-8")));
  } catch {
    sendServerMessage(ws, { type: "error", code: "PARSE_ERROR", message: "Invalid JSON or unknown message type" });
    return;
  }

  switch (msg.type) {
    case "start": {
      if (!VOLCENGINE_SPEAKER) {
        sendServerMessage(ws, { type: "error", requestId: msg.requestId, code: "CONFIG_ERROR", message: "VOLCENGINE_TTS_SPEAKER is not set" });
        return;
      }
      const template = buildRequestTemplate();
      const result = tryStart(sm, msg.requestId, randomUUID(), template);
      if (!result.success) {
        sendServerMessage(ws, result.error!);
        return;
      }
      log("info", "Starting TTS session", { requestId: msg.requestId, sessionId: result.sessionId });
      const startSessionPayload = { ...template, event: Event.StartSession };
      try {
        doubaoSocket.send(encodeStartSession(result.sessionId!, startSessionPayload));
      } catch (err) {
        log("error", "Failed to send StartSession", { error: String(err) });
        reset(sm);
        sendServerMessage(ws, { type: "error", requestId: msg.requestId, code: "SEND_ERROR", message: "Failed to send StartSession" });
      }
      break;
    }
    case "text_delta": {
      const result = tryTextDelta(sm, msg.requestId);
      if (!result.success) {
        sendServerMessage(ws, result.error!);
        return;
      }
      const template = sm.requestTemplate!;
      const taskPayload = {
        ...template,
        event: Event.TaskRequest,
        req_params: {
          ...template.req_params,
          text: msg.text,
        },
      };
      try {
        doubaoSocket.send(encodeTaskRequest(sm.activeSessionId!, taskPayload));
      } catch (err) {
        log("error", "Failed to send TaskRequest", { error: String(err) });
        sendServerMessage(ws, { type: "error", requestId: msg.requestId, code: "SEND_ERROR", message: "Failed to send text" });
      }
      break;
    }
    case "finish": {
      const result = tryFinish(sm, msg.requestId);
      if (!result.success) {
        sendServerMessage(ws, result.error!);
        return;
      }
      log("info", "Finishing session", { sessionId: sm.activeSessionId });
      try {
        doubaoSocket.send(encodeFinishSession(sm.activeSessionId!));
      } catch (err) {
        log("error", "Failed to send FinishSession", { error: String(err) });
        const reqId = sm.activeRequestId;
        reset(sm);
        sendServerMessage(ws, { type: "error", requestId: reqId ?? msg.requestId, code: "SEND_ERROR", message: "Failed to send FinishSession" });
      }
      break;
    }
    case "cancel": {
      const result = tryCancel(sm, msg.requestId);
      if (!result.success) {
        sendServerMessage(ws, result.error!);
        return;
      }
      if (!result.shouldSendToDoubao) {
        log("info", "Cancel already sent, ignoring duplicate", { requestId: msg.requestId });
        return;
      }
      log("info", "Cancelling session", { sessionId: sm.activeSessionId });
      try {
        doubaoSocket.send(encodeCancelSession(sm.activeSessionId!));
      } catch (err) {
        log("error", "Failed to send CancelSession", { error: String(err) });
        const reqId = sm.activeRequestId;
        reset(sm);
        sendServerMessage(ws, { type: "error", requestId: reqId ?? msg.requestId, code: "SEND_ERROR", message: "Failed to send CancelSession" });
      }
      break;
    }
  }
}

// -- 主入口 --

function start(): void {
  const missing: string[] = [];
  if (!VOLCENGINE_API_KEY) missing.push("VOLCENGINE_TTS_API_KEY");
  if (!VOLCENGINE_SPEAKER) missing.push("VOLCENGINE_TTS_SPEAKER");

  if (missing.length > 0) {
    log("warn", `Missing env vars: ${missing.join(", ")}. Gateway will start but TTS sessions will fail.`);
  }

  log("info", "Starting voice gateway", {
    host: GATEWAY_HOST,
    port: GATEWAY_PORT,
    apiKey: maskKey(VOLCENGINE_API_KEY),
    speaker: VOLCENGINE_SPEAKER ?? "<not set>",
    resourceId: VOLCENGINE_RESOURCE_ID,
    allowedOrigins: ALLOWED_ORIGINS,
  });

  const wss = new WebSocketServer({ host: GATEWAY_HOST, port: GATEWAY_PORT });

  wss.on("listening", () => {
    log("info", `Voice gateway listening on ws://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  });

  wss.on("error", (err) => {
    log("error", `WebSocket server error: ${err.message}`);
  });

  wss.on("connection", (browserWs: WebSocket, req) => {
    // Node 将 header 名规范化为小写，req.headers.origin 直接使用即可。
    // 允许缺失 Origin（如原生 ws 客户端直连），浏览器来源仍须匹配白名单。
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, ALLOWED_ORIGINS)) {
      log("warn", "Rejected connection from disallowed origin", { origin });
      sendServerMessage(browserWs, {
        type: "error",
        code: "ORIGIN_NOT_ALLOWED",
        message: `Origin "${origin}" is not allowed`,
      });
      browserWs.close(4001);
      return;
    }

    log("info", "Browser connected", { origin: origin ?? "<none>" });

    let sm: SessionStateMachine | null = null;
    let doubaoWs: WebSocket | null = null;
    let closed = false;

    connectDoubao()
      .then((doubao) => {
        if (closed) {
          doubao.socket.close();
          return;
        }

        sm = createSessionState();
        doubaoWs = doubao.socket;
        log("info", "Doubao connection established", { connectionId: doubao.connectionId });

        // ConnectionStarted → 通知浏览器已连接（仅表示可创建 session）
        sendServerMessage(browserWs, { type: "connected" });

        doubao.socket.on("message", (data: Buffer, isBinary: boolean) => {
          if (closed || !sm) return;

          if (!isBinary) {
            const textContent = data.toString("utf-8");
            log("error", "Doubao upstream text error", { text: textContent });
            const result = processDoubaoFrame(sm, {
              isTextError: true,
              textErrorContent: textContent,
              messageType: MessageType.Error,
            });
            applyFrameResult(browserWs, result);
            return;
          }

          const frame = parseFrame(data);
          if (frame) handleDoubaoFrame(sm, browserWs, frame);
        });

        doubao.socket.on("error", (err) => {
          log("error", "Doubao upstream error", { error: err.message });
          if (!closed && sm) {
            const requestId = sm.activeRequestId;
            reset(sm);
            sendServerMessage(browserWs, {
              type: "error",
              requestId: requestId ?? undefined,
              code: "UPSTREAM_ERROR",
              message: `Doubao connection error: ${err.message}`,
            });
          }
        });

        doubao.socket.on("close", (code) => {
          log("info", "Doubao upstream closed", { code });
          if (!closed) browserWs.close();
        });
      })
      .catch((err) => {
        log("error", "Failed to connect to Doubao", { error: String(err) });
        if (!closed) {
          sendServerMessage(browserWs, {
            type: "error",
            code: "UPSTREAM_CONNECT_FAILED",
            message: `Failed to connect to Doubao: ${err.message}`,
          });
          browserWs.close();
        }
      });

    browserWs.on("message", (data: Buffer) => {
      if (closed || !sm || !doubaoWs) {
        sendServerMessage(browserWs, {
          type: "error",
          code: "NOT_READY",
          message: "Gateway is not ready yet. Wait for 'connected' message.",
        });
        return;
      }
      handleClientMessage(sm, browserWs, doubaoWs, data);
    });

    browserWs.on("close", () => {
      log("info", "Browser disconnected");
      closed = true;
      if (sm && doubaoWs) {
        if (sm.activeSessionId && isActive(sm)) {
          try { doubaoWs.send(encodeCancelSession(sm.activeSessionId)); } catch { /* best effort */ }
        }
        reset(sm);
        doubaoWs.close();
        sm = null;
        doubaoWs = null;
      }
    });

    browserWs.on("error", (err) => {
      log("error", "Browser WebSocket error", { error: err.message });
    });
  });
}

start();
