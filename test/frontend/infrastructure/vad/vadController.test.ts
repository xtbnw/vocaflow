import assert from "node:assert/strict";
import { test } from "node:test";
import { VADController, type VADMediaDeps } from "../../../../frontend/infrastructure/vad/vadController";

// ---------------------------------------------------------------------------
// Fake media dependencies
// ---------------------------------------------------------------------------

interface FakeTrack {
  stop(): void;
  stopped: boolean;
}

function fakeTrack(): FakeTrack {
  const t = { stopped: false, stop() { t.stopped = true; } };
  return t;
}

/** A minimal fake MediaStream — tracks carry a .stopped flag for assertions. */
class FakeMediaStream {
  tracks: FakeTrack[] = [];
  getTracks(): FakeTrack[] { return this.tracks; }
}

/** A minimal fake AudioContext. */
class FakeAudioContext {
  closed = false;
  sampleRate: number;
  private analysers: FakeAnalyserNode[] = [];
  private sourceNodes: FakeMediaStreamSourceNode[] = [];

  constructor(opts: { sampleRate: number }) {
    this.sampleRate = opts.sampleRate;
  }

  createAnalyser(): FakeAnalyserNode {
    const a = new FakeAnalyserNode();
    this.analysers.push(a);
    return a;
  }

  createMediaStreamSource(_stream: FakeMediaStream): FakeMediaStreamSourceNode {
    const s = new FakeMediaStreamSourceNode();
    this.sourceNodes.push(s);
    return s;
  }

  close(): void {
    this.closed = true;
  }
}

class FakeAnalyserNode {
  fftSize = 256;
  connected = false;
  getFloatTimeDomainData(_buffer: Float32Array): void { /* noop */ }
}

class FakeMediaStreamSourceNode {
  connected = false;
  connect(_dest: FakeAnalyserNode): void {
    this.connected = true;
  }
  disconnect(): void {
    this.connected = false;
  }
}

interface FakeMediaDepsResult extends VADMediaDeps {
  stream: FakeMediaStream;
  audioContext: FakeAudioContext;
}

function createFakeMediaDeps(opts?: {
  getUserMediaDelayMs?: number;
  getUserMediaError?: Error;
  /** If set, createAnalyser will throw after this many successful calls. */
  analyserThrowOnCall?: number;
  /** If set, createMediaStreamSource will throw. */
  sourceThrow?: boolean;
}): FakeMediaDepsResult {
  const stream = new FakeMediaStream();
  stream.tracks = [fakeTrack()];
  let audioContext: FakeAudioContext | null = new FakeAudioContext({ sampleRate: 24000 });
  let analyserCallCount = 0;

  const self: FakeMediaDepsResult = {
    stream,
    get audioContext() { return audioContext!; },
    getUserMedia: opts?.getUserMediaError
      ? () => Promise.reject(opts.getUserMediaError)
      : opts?.getUserMediaDelayMs
        ? () => new Promise((r) => setTimeout(() => r(stream as unknown as MediaStream), opts.getUserMediaDelayMs))
        : () => Promise.resolve(stream as unknown as MediaStream),
    createAudioContext: (sampleRate: number) => {
      if (!audioContext || audioContext.closed) {
        audioContext = new FakeAudioContext({ sampleRate });
      }
      const ctx = audioContext as unknown as AudioContext;

      // Wrap to intercept createAnalyser / createMediaStreamSource for
      // fault-injection.
      const origCreateAnalyser = audioContext.createAnalyser.bind(audioContext);
      const origCreateMediaStreamSource = audioContext.createMediaStreamSource.bind(audioContext);

      audioContext.createAnalyser = () => {
        analyserCallCount++;
        if (opts?.analyserThrowOnCall !== undefined && analyserCallCount >= opts.analyserThrowOnCall) {
          throw new Error("createAnalyser failed");
        }
        return origCreateAnalyser();
      };

      if (opts?.sourceThrow) {
        audioContext.createMediaStreamSource = () => {
          throw new Error("createMediaStreamSource failed");
        };
      } else {
        audioContext.createMediaStreamSource = origCreateMediaStreamSource;
      }

      return ctx;
    },
  };

  return self;
}

// ---------------------------------------------------------------------------
// Tests — lifecycle & async cancellation
// ---------------------------------------------------------------------------

test("start creates analyser and starts polling", async () => {
  const deps = createFakeMediaDeps();
  let triggered = false;
  const vad = new VADController(() => { triggered = true; }, () => {}, undefined, deps);

  await vad.start();
  assert.strictEqual(vad.isRunning, true);
  assert.strictEqual(triggered, false);
  assert.strictEqual(deps.stream.tracks[0].stopped, false);

  vad.stop();
  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(deps.stream.tracks[0].stopped, true);
  assert.strictEqual(deps.audioContext.closed, true);
});

test("stop while awaiting getUserMedia discards the pending start", async () => {
  const deps = createFakeMediaDeps({ getUserMediaDelayMs: 50 });

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, deps);

  const startPromise = vad.start();
  vad.stop();

  await startPromise;

  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 0);
  // Track should be stopped because getUserMedia resolved before gen check,
  // then gen mismatch caused the start to release the stream
});

test("dispose while awaiting getUserMedia discards the pending start", async () => {
  const deps = createFakeMediaDeps({ getUserMediaDelayMs: 50 });

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, deps);

  const startPromise = vad.start();
  vad.dispose();

  await startPromise;
  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 0);
});

test("pending getUserMedia → stop() → getUserMedia rejects: no onError", async () => {
  // A getUserMedia that never resolves, then rejects after a delay.
  // We stop() during the pending period.
  const deps = createFakeMediaDeps({ getUserMediaDelayMs: 30 });
  let rejectGum: (err: Error) => void;
  const gumPromise = new Promise<MediaStream>((_resolve, reject) => { rejectGum = reject; });

  let gumCallCount = 0;
  const media: VADMediaDeps = {
    getUserMedia: () => { gumCallCount++; return gumPromise; },
    createAudioContext: deps.createAudioContext,
  };

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, media);

  const startPromise = vad.start();
  // stop before getUserMedia settles
  vad.stop();

  // Now reject the getUserMedia
  rejectGum!(new Error("Permission denied"));

  await startPromise;
  assert.strictEqual(vad.isRunning, false);
  // Must NOT fire onError — the generation was invalidated by stop()
  assert.strictEqual(errors.length, 0);
});

test("pending getUserMedia → dispose() → getUserMedia rejects: no onError", async () => {
  const deps = createFakeMediaDeps({ getUserMediaDelayMs: 30 });
  let rejectGum: (err: Error) => void;
  const gumPromise = new Promise<MediaStream>((_resolve, reject) => { rejectGum = reject; });

  const media: VADMediaDeps = {
    getUserMedia: () => gumPromise,
    createAudioContext: deps.createAudioContext,
  };

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, media);

  const startPromise = vad.start();
  vad.dispose();

  rejectGum!(new Error("Permission denied"));

  await startPromise;
  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 0);
});

test("getUserMedia permission denied calls onError and sets running false", async () => {
  const deps = createFakeMediaDeps({
    getUserMediaError: new Error("Permission denied"),
  });

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, deps);

  await vad.start();
  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("无法获取麦克风"));
});

test("AudioContext creation failure calls onError", async () => {
  const deps = createFakeMediaDeps();
  let ctxCallCount = 0;
  const media: VADMediaDeps = {
    getUserMedia: deps.getUserMedia,
    createAudioContext: () => {
      ctxCallCount++;
      throw new Error("NotSupported");
    },
  };

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, media);

  await vad.start();
  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("AudioContext"));
  assert.strictEqual(ctxCallCount, 1);
});

test("AudioContext creation failure after stop: no onError, stream released", async () => {
  const deps = createFakeMediaDeps({ getUserMediaDelayMs: 10 });
  let ctxCallCount = 0;
  const media: VADMediaDeps = {
    getUserMedia: deps.getUserMedia,
    createAudioContext: () => {
      ctxCallCount++;
      throw new Error("NotSupported");
    },
  };

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, media);

  // Start (will await getUserMedia, then fail at createAudioContext)
  const startPromise = vad.start();
  // Stop during getUserMedia await — gen becomes stale
  vad.stop();

  await startPromise;
  assert.strictEqual(vad.isRunning, false);
  // Must NOT trigger onError — gen was stale by the time AudioContext failed
  assert.strictEqual(errors.length, 0);
  // Stream tracks must be released
  assert.strictEqual(deps.stream.tracks[0].stopped, true);
});

test("analyser creation throws: releases tracks, closes AudioContext, fires onError", async () => {
  const deps = createFakeMediaDeps({ analyserThrowOnCall: 1 });

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, deps);

  await vad.start();

  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("VAD 初始化失败"));
  // Resources must be released
  assert.strictEqual(deps.stream.tracks[0].stopped, true);
  assert.strictEqual(deps.audioContext.closed, true);
});

test("media source creation throws: releases tracks, closes AudioContext, fires onError", async () => {
  const deps = createFakeMediaDeps({ sourceThrow: true });

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, deps);

  await vad.start();

  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 1);
  assert.ok(errors[0].includes("VAD 初始化失败"));
  assert.strictEqual(deps.stream.tracks[0].stopped, true);
  assert.strictEqual(deps.audioContext.closed, true);
});

test("analyser creation throws after stop: no onError, resources released", async () => {
  const deps = createFakeMediaDeps({ getUserMediaDelayMs: 10, analyserThrowOnCall: 1 });

  const errors: string[] = [];
  const vad = new VADController(() => {}, (m) => errors.push(m), undefined, deps);

  const startPromise = vad.start();
  vad.stop();

  await startPromise;
  assert.strictEqual(vad.isRunning, false);
  assert.strictEqual(errors.length, 0);
  // Stream tracks must be released after gen mismatch
  assert.strictEqual(deps.stream.tracks[0].stopped, true);
});

test("dispose is safe to call multiple times", async () => {
  const deps = createFakeMediaDeps();
  const vad = new VADController(() => {}, () => {}, undefined, deps);
  await vad.start();

  vad.dispose();
  vad.dispose();
  vad.dispose();
  assert.strictEqual(vad.isRunning, false);
});

test("stop is safe to call when not running", () => {
  const deps = createFakeMediaDeps();
  const vad = new VADController(() => {}, () => {}, undefined, deps);
  vad.stop();
  assert.strictEqual(vad.isRunning, false);
});
