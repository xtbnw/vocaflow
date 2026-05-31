import assert from "node:assert/strict";
import { test } from "node:test";
import { createPcmPlaybackQueue, int16ToFloat32 } from "../../../../frontend/infrastructure/tts/pcmPlayer";

class FakeSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  startTime: number | null = null;
  stopped = false;

  connect(): void {}
  start(time?: number): void { this.startTime = time ?? 0; }
  stop(): void { this.stopped = true; }
  end(): void { this.onended?.(); }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 10;
  destination = {} as AudioDestinationNode;
  sources: FakeSource[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length);
    return {
      duration: length / sampleRate,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.state = "closed";
  }
}

function pcm(...samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return buffer;
}

test("int16ToFloat32 converts PCM boundary values", () => {
  const result = int16ToFloat32(pcm(0, 32767, -32768, 16384, -16384));
  assert.equal(result[0], 0);
  assert.ok(Math.abs(result[1] - 32767 / 32768) < 0.0001);
  assert.equal(result[2], -1);
  assert.equal(result[3], 0.5);
  assert.equal(result[4], -0.5);
});

test("real playback queue schedules PCM chunks sequentially", async () => {
  const ctx = new FakeAudioContext();
  const queue = createPcmPlaybackQueue(() => ctx as unknown as AudioContext);
  await queue.ensureContext();

  queue.enqueue(pcm(100, 200));
  queue.enqueue(pcm(300, 400));

  assert.equal(ctx.sources.length, 2);
  assert.equal(ctx.sources[0].startTime, 10);
  assert.equal(ctx.sources[1].startTime, 10 + 2 / 24000);
  assert.equal(queue.playing, true);
});

test("real playback queue converts samples before scheduling", async () => {
  const ctx = new FakeAudioContext();
  const queue = createPcmPlaybackQueue(() => ctx as unknown as AudioContext);
  await queue.ensureContext();
  queue.enqueue(pcm(16384, -16384));

  const channel = ctx.sources[0].buffer!.getChannelData(0);
  assert.equal(channel[0], 0.5);
  assert.equal(channel[1], -0.5);
});

test("real playback queue clear stops all sources and reports idle", async () => {
  const ctx = new FakeAudioContext();
  const states: boolean[] = [];
  const queue = createPcmPlaybackQueue(
    () => ctx as unknown as AudioContext,
    (playing) => states.push(playing),
  );
  await queue.ensureContext();
  queue.enqueue(pcm(1));
  queue.enqueue(pcm(2));
  queue.clear();

  assert.deepEqual(ctx.sources.map((source) => source.stopped), [true, true]);
  assert.equal(queue.playing, false);
  assert.deepEqual(states, [true, false]);
});

test("real playback queue reports idle after last source ends", async () => {
  const ctx = new FakeAudioContext();
  const states: boolean[] = [];
  const queue = createPcmPlaybackQueue(
    () => ctx as unknown as AudioContext,
    (playing) => states.push(playing),
  );
  await queue.ensureContext();
  queue.enqueue(pcm(1));
  queue.enqueue(pcm(2));

  ctx.sources[0].end();
  assert.equal(queue.playing, true);
  ctx.sources[1].end();
  assert.equal(queue.playing, false);
  assert.deepEqual(states, [true, false]);
});

test("real playback queue resumes a suspended context", async () => {
  const ctx = new FakeAudioContext();
  ctx.state = "suspended";
  const queue = createPcmPlaybackQueue(() => ctx as unknown as AudioContext);
  await queue.ensureContext();
  assert.equal(ctx.resumeCalls, 1);
  assert.equal(ctx.state, "running");
});

test("real playback queue dispose closes its context", async () => {
  const ctx = new FakeAudioContext();
  const queue = createPcmPlaybackQueue(() => ctx as unknown as AudioContext);
  await queue.ensureContext();
  queue.dispose();
  assert.equal(ctx.closeCalls, 1);
});
