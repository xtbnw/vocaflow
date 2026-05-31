import assert from "node:assert/strict";
import { test } from "node:test";
import { TtsController, type TtsWebSocket } from "../../../../frontend/infrastructure/tts/ttsController";
import type { PcmPlaybackQueue } from "../../../../frontend/infrastructure/tts/pcmPlayer";

function createMockQueue(): PcmPlaybackQueue & { cleared: number; disposed: boolean; enqueued: ArrayBuffer[] } {
  return {
    cleared: 0,
    disposed: false,
    enqueued: [],
    async ensureContext() {},
    enqueue(data) { this.enqueued.push(data); },
    clear() { this.cleared++; },
    get playing() { return false; },
    dispose() { this.disposed = true; },
  };
}

function createMockWs() {
  const listeners: Record<string, Array<(event?: { data: string | ArrayBuffer }) => void>> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };
  return {
    readyState: 1,
    sent: [] as string[],
    closed: false,
    send(data: string | ArrayBuffer) { this.sent.push(typeof data === "string" ? data : "[binary]"); },
    close() { this.closed = true; },
    addEventListener(type: string, listener: (event?: { data: string | ArrayBuffer }) => void) {
      listeners[type].push(listener);
    },
    removeEventListener() {},
    emit(type: string, data?: string | ArrayBuffer) {
      for (const listener of listeners[type]) listener(data === undefined ? undefined : { data });
    },
  } as TtsWebSocket & {
    sent: string[];
    closed: boolean;
    emit(type: string, data?: string | ArrayBuffer): void;
  };
}

function messages(ws: ReturnType<typeof createMockWs>, type?: string): Array<Record<string, string>> {
  return ws.sent
    .filter((entry) => entry !== "[binary]")
    .map((entry) => JSON.parse(entry) as Record<string, string>)
    .filter((entry) => !type || entry.type === type);
}

function connect(ws: ReturnType<typeof createMockWs>): void {
  ws.emit("open");
  ws.emit("message", JSON.stringify({ type: "connected" }));
}

function ready(ws: ReturnType<typeof createMockWs>, requestId: string): void {
  ws.emit("message", JSON.stringify({ type: "ready", requestId }));
}

test("buffers deltas before connected and flushes them after ready", async () => {
  const ws = createMockWs();
  const tts = new TtsController(createMockQueue(), () => {}, () => ws);
  const started = tts.start();
  tts.appendText("first");
  tts.appendText(" second");

  connect(ws);
  const requestId = messages(ws, "start")[0].requestId;
  assert.equal(messages(ws, "text_delta").length, 0);
  ready(ws, requestId);
  await started;

  assert.deepEqual(messages(ws, "text_delta").map((msg) => msg.text), ["first", " second"]);
  tts.dispose();
});

test("finish before ready flushes text_delta before finish", async () => {
  const ws = createMockWs();
  const tts = new TtsController(createMockQueue(), () => {}, () => ws);
  const started = tts.start();
  tts.appendText("answer");
  tts.finish();
  connect(ws);
  const requestId = messages(ws, "start")[0].requestId;
  ready(ws, requestId);
  await started;

  assert.deepEqual(messages(ws).map((msg) => msg.type), ["start", "text_delta", "finish"]);
  tts.dispose();
});

test("new start after cancel waits for canceled acknowledgement", async () => {
  const ws = createMockWs();
  const tts = new TtsController(createMockQueue(), () => {}, () => ws);
  const first = tts.start();
  connect(ws);
  const firstId = messages(ws, "start")[0].requestId;
  ready(ws, firstId);
  await first;

  const second = tts.start();
  second.catch(() => {});
  assert.equal(messages(ws, "cancel").length, 1);
  assert.equal(messages(ws, "start").length, 1);

  ws.emit("message", JSON.stringify({ type: "canceled", requestId: firstId }));
  assert.equal(messages(ws, "start").length, 2);
  const secondId = messages(ws, "start")[1].requestId;
  ready(ws, secondId);
  await second;
  tts.dispose();
});

test("new start after finish waits for ended acknowledgement", async () => {
  const ws = createMockWs();
  const tts = new TtsController(createMockQueue(), () => {}, () => ws);
  const first = tts.start();
  connect(ws);
  const firstId = messages(ws, "start")[0].requestId;
  ready(ws, firstId);
  await first;
  tts.finish();

  const second = tts.start();
  second.catch(() => {});
  assert.equal(messages(ws, "start").length, 1);
  ws.emit("message", JSON.stringify({ type: "ended", requestId: firstId }));
  assert.equal(messages(ws, "start").length, 2);

  const secondId = messages(ws, "start")[1].requestId;
  ready(ws, secondId);
  await second;
  tts.dispose();
});

test("idle controller reuses connected socket and sends a new start", async () => {
  const ws = createMockWs();
  const tts = new TtsController(createMockQueue(), () => {}, () => ws);
  const first = tts.start();
  connect(ws);
  const firstId = messages(ws, "start")[0].requestId;
  ready(ws, firstId);
  await first;
  tts.finish();
  ws.emit("message", JSON.stringify({ type: "ended", requestId: firstId }));

  const second = tts.start();
  assert.equal(messages(ws, "start").length, 2);
  const secondId = messages(ws, "start")[1].requestId;
  ready(ws, secondId);
  await second;
  tts.dispose();
});

test("stale terminal message does not release current round", async () => {
  const ws = createMockWs();
  const tts = new TtsController(createMockQueue(), () => {}, () => ws);
  const started = tts.start();
  connect(ws);
  const requestId = messages(ws, "start")[0].requestId;
  ready(ws, requestId);
  await started;

  ws.emit("message", JSON.stringify({ type: "ended", requestId: "stale" }));
  tts.appendText("still current");
  assert.equal(messages(ws, "text_delta")[0].text, "still current");
  tts.dispose();
});

test("server error releases current round so next start can proceed", async () => {
  const ws = createMockWs();
  const errors: string[] = [];
  const tts = new TtsController(createMockQueue(), (message) => errors.push(message), () => ws);
  const first = tts.start();
  connect(ws);
  const firstId = messages(ws, "start")[0].requestId;
  ready(ws, firstId);
  await first;

  ws.emit("message", JSON.stringify({ type: "error", requestId: firstId, code: "TEST", message: "failed" }));
  assert.equal(errors.at(-1), "failed");

  const second = tts.start();
  assert.equal(messages(ws, "start").length, 2);
  const secondId = messages(ws, "start")[1].requestId;
  ready(ws, secondId);
  await second;
  tts.dispose();
});

test("invalid gateway control message reports a voice error", () => {
  const ws = createMockWs();
  const errors: string[] = [];
  const tts = new TtsController(createMockQueue(), (message) => errors.push(message), () => ws);
  void tts.start().catch(() => {});
  connect(ws);
  ws.emit("message", JSON.stringify({ type: "unknown" }));
  assert.equal(errors.at(-1), "语音网关返回了无效消息");
  tts.dispose();
});

test("binary audio frame is forwarded to playback queue", () => {
  const ws = createMockWs();
  const queue = createMockQueue();
  const tts = new TtsController(queue, () => {}, () => ws);
  void tts.start().catch(() => {});
  connect(ws);
  const audio = new ArrayBuffer(4);
  ws.emit("message", audio);
  assert.deepEqual(queue.enqueued, [audio]);
  tts.dispose();
});

test("cancel clears local playback immediately", () => {
  const ws = createMockWs();
  const queue = createMockQueue();
  const tts = new TtsController(queue, () => {}, () => ws);
  void tts.start().catch(() => {});
  tts.cancel();
  assert.equal(queue.cleared, 1);
  tts.dispose();
});

test("connection failure reports voice error without throwing synchronously", async () => {
  const ws = createMockWs();
  const errors: string[] = [];
  const tts = new TtsController(createMockQueue(), (message) => errors.push(message), () => ws);
  const started = tts.start();
  ws.emit("error");
  await assert.rejects(started);
  assert.equal(errors.at(-1), "语音网关连接失败");
  tts.dispose();
});

test("replacement round while connecting also rejects when connection fails", async () => {
  const ws = createMockWs();
  const tts = new TtsController(createMockQueue(), () => {}, () => ws);
  const first = tts.start();
  void first.catch(() => {});
  const second = tts.start();

  ws.emit("error");
  await assert.rejects(second);
  tts.dispose();
});
