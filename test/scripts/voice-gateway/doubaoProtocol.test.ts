import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Event,
  MessageType,
  Serialization,
  Compression,
  encodeStartConnection,
  encodeFinishConnection,
  encodeStartSession,
  encodeFinishSession,
  encodeCancelSession,
  encodeTaskRequest,
  parseFrame,
  eventName,
} from "../../../scripts/voice-gateway/doubaoProtocol";

// -- 帧编码测试 --

test("encodeStartConnection produces correct binary frame", () => {
  const buf = encodeStartConnection();
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length >= 12);

  // Header
  assert.equal(buf[0], 0x11); // v1, 4-byte header
  assert.equal(buf[1], 0x14); // Full-client request, with event
  assert.equal(buf[2], 0x10); // JSON, no compression
  assert.equal(buf[3], 0x00); // reserved

  // Event = 1 (StartConnection)
  assert.equal(buf.readInt32BE(4), Event.StartConnection);

  // Payload length = 2 ("{}")
  assert.equal(buf.readUInt32BE(8), 2);
  assert.equal(buf.subarray(12, 14).toString("utf-8"), "{}");
});

test("encodeFinishConnection produces correct binary frame", () => {
  const buf = encodeFinishConnection();
  assert.equal(buf.readInt32BE(4), Event.FinishConnection);
  assert.equal(buf.readUInt32BE(8), 2);
  assert.equal(buf.subarray(12, 14).toString("utf-8"), "{}");
});

test("encodeStartSession produces correct binary frame with sessionId", () => {
  const sessionId = "test-session-123";
  const params = { user: { uid: "test" }, event: 100, req_params: { speaker: "speaker1", model: "seed-tts-2.0-standard", audio_params: { format: "pcm", sample_rate: 24000 } } };
  const buf = encodeStartSession(sessionId, params);

  assert.equal(buf.readInt32BE(4), Event.StartSession);

  // Session ID
  const sidLen = buf.readUInt32BE(8);
  assert.equal(sidLen, sessionId.length);
  assert.equal(buf.subarray(12, 12 + sidLen).toString("utf-8"), sessionId);

  // Payload
  const payloadOffset = 12 + sidLen;
  const payloadLen = buf.readUInt32BE(payloadOffset);
  const payload = JSON.parse(buf.subarray(payloadOffset + 4, payloadOffset + 4 + payloadLen).toString("utf-8"));
  assert.equal(payload.req_params.speaker, "speaker1");
  assert.equal(payload.req_params.model, "seed-tts-2.0-standard");
  assert.equal(payload.req_params.audio_params.format, "pcm");
  assert.equal(payload.req_params.audio_params.sample_rate, 24000);
});

test("encodeFinishSession produces correct binary frame", () => {
  const sessionId = "test-session-456";
  const buf = encodeFinishSession(sessionId);

  assert.equal(buf.readInt32BE(4), Event.FinishSession);

  const sidLen = buf.readUInt32BE(8);
  assert.equal(buf.subarray(12, 12 + sidLen).toString("utf-8"), sessionId);

  const payloadOffset = 12 + sidLen;
  const payloadLen = buf.readUInt32BE(payloadOffset);
  assert.equal(buf.subarray(payloadOffset + 4, payloadOffset + 4 + payloadLen).toString("utf-8"), "{}");
});

test("encodeCancelSession produces correct binary frame", () => {
  const sessionId = "cancel-me";
  const buf = encodeCancelSession(sessionId);

  assert.equal(buf.readInt32BE(4), Event.CancelSession);
  const sidLen = buf.readUInt32BE(8);
  assert.equal(buf.subarray(12, 12 + sidLen).toString("utf-8"), sessionId);
});

test("encodeTaskRequest produces correct binary frame with full payload", () => {
  const sessionId = "task-session";
  const payload = {
    user: { uid: "test-user" },
    event: Event.TaskRequest,
    req_params: {
      speaker: "test-speaker",
      model: "seed-tts-2.0-standard",
      audio_params: { format: "pcm", sample_rate: 24000 },
      text: "你好世界",
    },
  };
  const buf = encodeTaskRequest(sessionId, payload);

  assert.equal(buf.readInt32BE(4), Event.TaskRequest);

  const sidLen = buf.readUInt32BE(8);
  assert.equal(buf.subarray(12, 12 + sidLen).toString("utf-8"), sessionId);

  const payloadOffset = 12 + sidLen;
  const payloadLen = buf.readUInt32BE(payloadOffset);
  const decoded = JSON.parse(buf.subarray(payloadOffset + 4, payloadOffset + 4 + payloadLen).toString("utf-8"));
  assert.equal(decoded.event, Event.TaskRequest);
  assert.equal(decoded.user.uid, "test-user");
  assert.equal(decoded.req_params.text, "你好世界");
  assert.equal(decoded.req_params.speaker, "test-speaker");
  assert.equal(decoded.req_params.model, "seed-tts-2.0-standard");
  assert.equal(decoded.req_params.audio_params.format, "pcm");
  assert.equal(decoded.req_params.audio_params.sample_rate, 24000);
});

// -- 帧解码测试 --

test("parseFrame decodes ConnectionStarted response", () => {
  // Build synthetic ConnectionStarted frame
  const connId = "abc123";
  const connIdBuf = Buffer.from(connId, "utf-8");
  const payload = Buffer.from("{}", "utf-8");

  const parts: Buffer[] = [];
  // Header
  const header = Buffer.alloc(4);
  header[0] = 0x11;
  header[1] = 0x94; // Full-server response, with event
  header[2] = 0x10; // JSON, no compression
  header[3] = 0x00;
  parts.push(header);

  // Event
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.ConnectionStarted, 0);
  parts.push(eventBuf);

  // Connection ID len + data
  const connIdLenBuf = Buffer.alloc(4);
  connIdLenBuf.writeUInt32BE(connIdBuf.length, 0);
  parts.push(connIdLenBuf);
  parts.push(connIdBuf);

  // Payload len + data
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(payload.length, 0);
  parts.push(payloadLenBuf);
  parts.push(payload);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);
  assert.equal(frame.messageType, MessageType.FullServerResponse);
  assert.equal(frame.event, Event.ConnectionStarted);
  assert.equal(frame.connectionId, connId);
  assert.equal(frame.serialization, Serialization.Json);
});

test("parseFrame decodes SessionStarted response", () => {
  const sessionId = "sess-001";
  const sidBuf = Buffer.from(sessionId, "utf-8");
  const payload = Buffer.from("{}", "utf-8");

  const parts: Buffer[] = [];
  const header = Buffer.from([0x11, 0x94, 0x10, 0x00]);
  parts.push(header);
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.SessionStarted, 0);
  parts.push(eventBuf);
  const sidLenBuf = Buffer.alloc(4);
  sidLenBuf.writeUInt32BE(sidBuf.length, 0);
  parts.push(sidLenBuf);
  parts.push(sidBuf);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(payload.length, 0);
  parts.push(payloadLenBuf);
  parts.push(payload);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);
  assert.equal(frame.event, Event.SessionStarted);
  assert.equal(frame.sessionId, sessionId);
});

test("parseFrame decodes SessionFinished with response_meta", () => {
  const sessionId = "sess-fin";
  const sidBuf = Buffer.from(sessionId, "utf-8");
  const payload = Buffer.from(JSON.stringify({ status_code: 20000000, message: "ok" }), "utf-8");

  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0x94, 0x10, 0x00]));
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.SessionFinished, 0);
  parts.push(eventBuf);
  const sidLenBuf = Buffer.alloc(4);
  sidLenBuf.writeUInt32BE(sidBuf.length, 0);
  parts.push(sidLenBuf);
  parts.push(sidBuf);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(payload.length, 0);
  parts.push(payloadLenBuf);
  parts.push(payload);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);
  assert.equal(frame.event, Event.SessionFinished);
  assert.equal(frame.sessionId, sessionId);
  assert.ok(frame.payloadJson);
  assert.equal((frame.payloadJson as Record<string, unknown>).status_code, 20000000);
});

test("parseFrame decodes TTSResponse audio frame", () => {
  const sessionId = "audio-sess";
  const sidBuf = Buffer.from(sessionId, "utf-8");
  const audioData = Buffer.from([0x01, 0x02, 0x03, 0x04]);

  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0xB4, 0x00, 0x00])); // Audio-only response, with event, raw
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeInt32BE(Event.TTSResponse, 0);
  parts.push(eventBuf);
  const sidLenBuf = Buffer.alloc(4);
  sidLenBuf.writeUInt32BE(sidBuf.length, 0);
  parts.push(sidLenBuf);
  parts.push(sidBuf);
  const audioLenBuf = Buffer.alloc(4);
  audioLenBuf.writeUInt32BE(audioData.length, 0);
  parts.push(audioLenBuf);
  parts.push(audioData);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);
  assert.equal(frame.messageType, MessageType.AudioOnlyResponse);
  assert.equal(frame.event, Event.TTSResponse);
  assert.equal(frame.sessionId, sessionId);
  assert.ok(frame.audioData);
  assert.deepEqual(frame.audioData, audioData);
});

test("parseFrame decodes error frame", () => {
  const errorCode = 45000001;
  const errorPayload = Buffer.from(JSON.stringify({ status_code: errorCode, message: "invalid request" }), "utf-8");

  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x11, 0xF0, 0x10, 0x00])); // Error, no flags, JSON
  const codeBuf = Buffer.alloc(4);
  codeBuf.writeInt32BE(errorCode, 0);
  parts.push(codeBuf);
  const payloadLenBuf = Buffer.alloc(4);
  payloadLenBuf.writeUInt32BE(errorPayload.length, 0);
  parts.push(payloadLenBuf);
  parts.push(errorPayload);

  const frame = parseFrame(Buffer.concat(parts));
  assert.ok(frame);
  assert.equal(frame.messageType, MessageType.Error);
  assert.equal(frame.errorCode, errorCode);
  assert.ok(frame.payloadJson);
  assert.equal((frame.payloadJson as Record<string, unknown>).message, "invalid request");
});

test("parseFrame returns null for incomplete frame", () => {
  const incomplete = Buffer.from([0x11, 0x14]);
  assert.equal(parseFrame(incomplete), null);
});

// -- 事件名称映射测试 --

test("eventName returns correct names for all known events", () => {
  assert.equal(eventName(Event.StartConnection), "StartConnection");
  assert.equal(eventName(Event.FinishConnection), "FinishConnection");
  assert.equal(eventName(Event.ConnectionStarted), "ConnectionStarted");
  assert.equal(eventName(Event.ConnectionFailed), "ConnectionFailed");
  assert.equal(eventName(Event.ConnectionFinished), "ConnectionFinished");
  assert.equal(eventName(Event.StartSession), "StartSession");
  assert.equal(eventName(Event.CancelSession), "CancelSession");
  assert.equal(eventName(Event.FinishSession), "FinishSession");
  assert.equal(eventName(Event.SessionStarted), "SessionStarted");
  assert.equal(eventName(Event.SessionCanceled), "SessionCanceled");
  assert.equal(eventName(Event.SessionFinished), "SessionFinished");
  assert.equal(eventName(Event.SessionFailed), "SessionFailed");
  assert.equal(eventName(Event.TaskRequest), "TaskRequest");
  assert.equal(eventName(Event.TTSSentenceStart), "TTSSentenceStart");
  assert.equal(eventName(Event.TTSSentenceEnd), "TTSSentenceEnd");
  assert.equal(eventName(Event.TTSResponse), "TTSResponse");
});

test("eventName returns Unknown for unknown event code", () => {
  assert.ok(eventName(999).startsWith("Unknown"));
});

// -- 往返测试 --

test("encode StartConnection → parse round-trip", () => {
  const encoded = encodeStartConnection();
  const frame = parseFrame(encoded);
  assert.ok(frame);
  assert.equal(frame.messageType, MessageType.FullClientRequest);
  assert.equal(frame.event, Event.StartConnection);
  assert.equal(frame.serialization, Serialization.Json);
  assert.equal(frame.compression, Compression.None);
});

test("encode StartSession → parse round-trip preserves sessionId", () => {
  const sessionId = "roundtrip-test-789";
  const params = { user: { uid: "v" }, event: 100, req_params: { speaker: "s", model: "m", audio_params: { format: "pcm", sample_rate: 24000 } } };
  const encoded = encodeStartSession(sessionId, params);
  const frame = parseFrame(encoded);
  assert.ok(frame);
  assert.equal(frame.event, Event.StartSession);
  assert.equal(frame.sessionId, sessionId);
  assert.ok(frame.payloadJson);
});

// -- 所有事件编号唯一性验证 --

test("all event codes are unique", () => {
  const events = [
    Event.StartConnection,
    Event.FinishConnection,
    Event.ConnectionStarted,
    Event.ConnectionFailed,
    Event.ConnectionFinished,
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
  ];
  const seen = new Set<number>();
  for (const e of events) {
    assert.ok(!seen.has(e), `Duplicate event code: ${e}`);
    seen.add(e);
  }
});
