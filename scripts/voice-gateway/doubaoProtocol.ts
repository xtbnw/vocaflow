// 豆包双向流式 TTS WebSocket 二进制协议
// 参考: docs/API参考文档/ws双向流式语音.md

// -- 协议常量 --

export const PROTOCOL_VERSION = 0x1;
export const HEADER_SIZE = 0x1; // 4-byte header (in units of 4)

export const enum MessageType {
  FullClientRequest = 0x1,
  FullServerResponse = 0x9,
  AudioOnlyResponse = 0xb,
  Error = 0xf,
}

export const enum Flag {
  None = 0x0,
  WithEvent = 0x4,
}

export const enum Serialization {
  Raw = 0x0,
  Json = 0x1,
}

export const enum Compression {
  None = 0x0,
  Gzip = 0x1,
}

// -- Event 常量 --

export const enum Event {
  StartConnection = 1,
  FinishConnection = 2,
  ConnectionStarted = 50,
  ConnectionFailed = 51,
  ConnectionFinished = 52,
  StartSession = 100,
  CancelSession = 101,
  FinishSession = 102,
  SessionStarted = 150,
  SessionCanceled = 151,
  SessionFinished = 152,
  SessionFailed = 153,
  TaskRequest = 200,
  TTSSentenceStart = 350,
  TTSSentenceEnd = 351,
  TTSResponse = 352,
}

// 不需要 id 字段的 connection 类事件
const CONNECTION_EVENTS_NO_ID = new Set<number>([Event.StartConnection, Event.FinishConnection]);

// 需要 connection_id 的 connection 响应事件
const CONNECTION_RESPONSE_EVENTS = new Set<number>([
  Event.ConnectionStarted,
  Event.ConnectionFailed,
  Event.ConnectionFinished,
]);

// 需要 session_id 的事件
const SESSION_EVENTS = new Set<number>([
  Event.StartSession,
  Event.CancelSession,
  Event.FinishSession,
  Event.SessionStarted,
  Event.SessionCanceled,
  Event.SessionFinished,
  Event.SessionFailed,
  Event.TaskRequest,
  Event.TTSSentenceStart,
  Event.TTSSentenceEnd,
  Event.TTSResponse,
]);

// -- 解析后的帧类型 --

export interface ParsedFrame {
  messageType: MessageType;
  serialization: Serialization;
  compression: Compression;
  event?: Event;
  errorCode?: number;
  connectionId?: string;
  sessionId?: string;
  /** JSON 帧的解析后 payload，仅当 serialization === Json 且 payload 非空时存在 */
  payloadJson?: unknown;
  /** 音频帧的原始二进制数据 */
  audioData?: Buffer;
  /** 原始 payload 二进制 */
  rawPayload: Buffer;
}

// -- 帧编码 --

function buildHeader(
  messageType: MessageType,
  flags: Flag,
  serialization: Serialization,
  compression: Compression,
): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  header[1] = (messageType << 4) | flags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0x00;
  return header;
}

function writeInt32(buf: number[], value: number): void {
  buf.push((value >>> 24) & 0xff);
  buf.push((value >>> 16) & 0xff);
  buf.push((value >>> 8) & 0xff);
  buf.push(value & 0xff);
}

function buildFrameWithEvent(
  messageType: MessageType,
  event: Event,
  serialization: Serialization,
  extraFields: Buffer[],
  payload: Buffer,
): Buffer {
  const parts: Buffer[] = [];
  parts.push(buildHeader(messageType, Flag.WithEvent, serialization, Compression.None));

  // event (int32 BE)
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(event, 0);
  parts.push(eventBuf);

  for (const field of extraFields) {
    parts.push(field);
  }

  // payload length (uint32 BE) + payload
  const payloadLen = Buffer.alloc(4);
  payloadLen.writeUInt32BE(payload.length, 0);
  parts.push(payloadLen);
  parts.push(payload);

  return Buffer.concat(parts);
}

/** 编码带 session_id 的事件帧 */
function buildSessionFrame(
  messageType: MessageType,
  event: Event,
  serialization: Serialization,
  sessionId: string,
  payload: Buffer,
): Buffer {
  const sessionIdBuf = Buffer.from(sessionId, "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(sessionIdBuf.length, 0);
  return buildFrameWithEvent(messageType, event, serialization, [lenBuf, sessionIdBuf], payload);
}

/** StartConnection — 建立连接 */
export function encodeStartConnection(): Buffer {
  return buildFrameWithEvent(
    MessageType.FullClientRequest,
    Event.StartConnection,
    Serialization.Json,
    [],
    Buffer.from("{}", "utf-8"),
  );
}

/** FinishConnection — 结束连接 */
export function encodeFinishConnection(): Buffer {
  return buildFrameWithEvent(
    MessageType.FullClientRequest,
    Event.FinishConnection,
    Serialization.Json,
    [],
    Buffer.from("{}", "utf-8"),
  );
}

/** StartSession — 创建 TTS 会话 */
export function encodeStartSession(sessionId: string, params: Record<string, unknown>): Buffer {
  return buildSessionFrame(
    MessageType.FullClientRequest,
    Event.StartSession,
    Serialization.Json,
    sessionId,
    Buffer.from(JSON.stringify(params), "utf-8"),
  );
}

/** FinishSession — 结束会话 */
export function encodeFinishSession(sessionId: string): Buffer {
  return buildSessionFrame(
    MessageType.FullClientRequest,
    Event.FinishSession,
    Serialization.Json,
    sessionId,
    Buffer.from("{}", "utf-8"),
  );
}

/** CancelSession — 取消会话 */
export function encodeCancelSession(sessionId: string): Buffer {
  return buildSessionFrame(
    MessageType.FullClientRequest,
    Event.CancelSession,
    Serialization.Json,
    sessionId,
    Buffer.from("{}", "utf-8"),
  );
}

/** TaskRequest — 发送文本（payload 须含完整请求模板） */
export function encodeTaskRequest(sessionId: string, payload: Record<string, unknown>): Buffer {
  return buildSessionFrame(
    MessageType.FullClientRequest,
    Event.TaskRequest,
    Serialization.Json,
    sessionId,
    Buffer.from(JSON.stringify(payload), "utf-8"),
  );
}

// -- 帧解码 --

function readInt32BE(buf: Buffer, offset: number): number {
  return buf.readInt32BE(offset);
}

function readUInt32BE(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

/**
 * 解析单个豆包二进制帧。
 * 返回 ParsedFrame 或 null（帧不完整时）。
 */
export function parseFrame(data: Buffer): ParsedFrame | null {
  if (data.length < 4) return null;

  const header0 = data[0];
  const header1 = data[1];
  const header2 = data[2];

  const messageType = (header1 >> 4) & 0xf;
  const flags = header1 & 0xf;
  const serialization = (header2 >> 4) & 0xf;
  const compression = header2 & 0xf;

  let offset = 4;

  // 错误帧: message_type=0xf, flags=0x0
  if (messageType === MessageType.Error && flags === Flag.None) {
    if (data.length < offset + 8) return null;
    const errorCode = readInt32BE(data, offset);
    offset += 4;
    const payloadLen = readUInt32BE(data, offset);
    offset += 4;
    if (data.length < offset + payloadLen) return null;
    const rawPayload = data.subarray(offset, offset + payloadLen);
    let payloadJson: unknown;
    try { payloadJson = JSON.parse(rawPayload.toString("utf-8")); } catch { /* ignore */ }
    return { messageType, serialization, compression, errorCode, rawPayload: Buffer.from(rawPayload), payloadJson };
  }

  // 非事件帧暂不支持
  if (!(flags & Flag.WithEvent)) {
    // 无事件帧：直接 payload
    if (data.length < offset + 4) return null;
    const payloadLen = readUInt32BE(data, offset);
    offset += 4;
    if (data.length < offset + payloadLen) return null;
    const rawPayload = data.subarray(offset, offset + payloadLen);
    return { messageType, serialization, compression, rawPayload: Buffer.from(rawPayload) };
  }

  // 带事件帧
  if (data.length < offset + 4) return null;
  const event = readInt32BE(data, offset);
  offset += 4;

  let connectionId: string | undefined;
  let sessionId: string | undefined;

  // 根据事件类型决定中间字段结构
  if (CONNECTION_RESPONSE_EVENTS.has(event)) {
    // connection_id + payload
    if (data.length < offset + 4) return null;
    const connIdLen = readUInt32BE(data, offset);
    offset += 4;
    if (data.length < offset + connIdLen) return null;
    connectionId = data.subarray(offset, offset + connIdLen).toString("utf-8");
    offset += connIdLen;
  } else if (SESSION_EVENTS.has(event)) {
    // session_id + payload
    if (data.length < offset + 4) return null;
    const sessIdLen = readUInt32BE(data, offset);
    offset += 4;
    if (data.length < offset + sessIdLen) return null;
    sessionId = data.subarray(offset, offset + sessIdLen).toString("utf-8");
    offset += sessIdLen;
  }
  // CONNECTION_EVENTS_NO_ID: 直接 payload

  // payload
  if (data.length < offset + 4) return null;
  const payloadLen = readUInt32BE(data, offset);
  offset += 4;
  if (data.length < offset + payloadLen) return null;
  const rawPayload = data.subarray(offset, offset + payloadLen);

  const result: ParsedFrame = {
    messageType,
    serialization,
    compression,
    event,
    connectionId,
    sessionId,
    rawPayload: Buffer.from(rawPayload),
  };

  if (messageType === MessageType.AudioOnlyResponse && serialization === Serialization.Raw) {
    result.audioData = Buffer.from(rawPayload);
  } else if (serialization === Serialization.Json && rawPayload.length > 0) {
    try { result.payloadJson = JSON.parse(rawPayload.toString("utf-8")); } catch { /* ignore */ }
  }

  return result;
}

// -- 事件名称映射 --

const EVENT_NAMES: Record<number, string> = {
  [Event.StartConnection]: "StartConnection",
  [Event.FinishConnection]: "FinishConnection",
  [Event.ConnectionStarted]: "ConnectionStarted",
  [Event.ConnectionFailed]: "ConnectionFailed",
  [Event.ConnectionFinished]: "ConnectionFinished",
  [Event.StartSession]: "StartSession",
  [Event.CancelSession]: "CancelSession",
  [Event.FinishSession]: "FinishSession",
  [Event.SessionStarted]: "SessionStarted",
  [Event.SessionCanceled]: "SessionCanceled",
  [Event.SessionFinished]: "SessionFinished",
  [Event.SessionFailed]: "SessionFailed",
  [Event.TaskRequest]: "TaskRequest",
  [Event.TTSSentenceStart]: "TTSSentenceStart",
  [Event.TTSSentenceEnd]: "TTSSentenceEnd",
  [Event.TTSResponse]: "TTSResponse",
};

export function eventName(code: number): string {
  return EVENT_NAMES[code] ?? `Unknown(${code})`;
}

// -- 握手消息分类（纯函数，可独立单元测试） --

export interface HandshakeClassification {
  outcome: "resolved" | "rejected" | "continue";
  connectionId?: string;
  reason?: string;
}

/**
 * 对握手阶段收到的单条消息进行分类。
 * - 文本错误帧 → rejected
 * - 二进制错误帧 (MessageType.Error) → rejected
 * - ConnectionStarted → resolved
 * - ConnectionFailed → rejected
 * - 其他/解析失败 → continue
 */
export function classifyHandshakeMessage(params: {
  isTextError: boolean;
  textContent?: string;
  frame?: ParsedFrame | null;
}): HandshakeClassification {
  if (params.isTextError) {
    return {
      outcome: "rejected",
      reason: `Doubao text error: ${params.textContent ?? ""}`,
    };
  }

  const frame = params.frame;
  if (!frame) return { outcome: "continue" };

  // 二进制错误帧
  if (frame.messageType === MessageType.Error) {
    const msg = frame.payloadJson && typeof frame.payloadJson === "object"
      ? (frame.payloadJson as Record<string, unknown>).message ?? `Doubao error (code=${frame.errorCode})`
      : `Doubao error (code=${frame.errorCode})`;
    return { outcome: "rejected", reason: `Doubao connection failed: ${msg}` };
  }

  if (frame.event === Event.ConnectionStarted) {
    return { outcome: "resolved", connectionId: frame.connectionId };
  }

  if (frame.event === Event.ConnectionFailed) {
    const msg = frame.payloadJson && typeof frame.payloadJson === "object"
      ? (frame.payloadJson as Record<string, unknown>).message ?? "Connection failed"
      : "Connection failed";
    return { outcome: "rejected", reason: `Doubao connection failed: ${msg}` };
  }

  return { outcome: "continue" };
}
