// PCM 24kHz 单声道播放队列 — 基于 Web Audio API
// 将豆包 TTS 输出的 int16 LE PCM 转换为浮点音频并分片顺序播放

/** 将小端序 int16 PCM 转换为 [-1, 1] 浮点数组 */
export function int16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export interface PcmPlaybackQueue {
  ensureContext(): Promise<void>;
  enqueue(pcmData: ArrayBuffer): void;
  clear(): void;
  readonly playing: boolean;
  dispose(): void;
}

export type AudioContextFactory = () => AudioContext;

export function createPcmPlaybackQueue(
  audioContextFactory?: AudioContextFactory,
  onStateChange?: (playing: boolean) => void,
): PcmPlaybackQueue {
  const factory = audioContextFactory ?? (() => new AudioContext({ sampleRate: 24000 }));
  let ctx: AudioContext | null = null;
  let nextStartTime = 0;
  let _playing = false;
  const scheduledSources: AudioBufferSourceNode[] = [];

  function setPlaying(p: boolean): void {
    if (_playing !== p) {
      _playing = p;
      onStateChange?.(p);
    }
  }

  function onSourceEnded(source: AudioBufferSourceNode): void {
    const idx = scheduledSources.indexOf(source);
    if (idx >= 0) scheduledSources.splice(idx, 1);
    if (scheduledSources.length === 0) {
      setPlaying(false);
      nextStartTime = 0;
    }
  }

  async function ensureContext(): Promise<void> {
    if (!ctx) {
      ctx = factory();
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  }

  function enqueue(pcmData: ArrayBuffer): void {
    if (!ctx) return;

    const floatData = int16ToFloat32(pcmData);
    const audioBuffer = ctx.createBuffer(1, floatData.length, 24000);
    audioBuffer.getChannelData(0).set(floatData);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startTime = Math.max(nextStartTime, ctx.currentTime);
    source.start(startTime);
    nextStartTime = startTime + audioBuffer.duration;
    scheduledSources.push(source);
    setPlaying(true);
    source.onended = () => onSourceEnded(source);
  }

  function clear(): void {
    for (const source of scheduledSources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    scheduledSources.length = 0;
    setPlaying(false);
    nextStartTime = 0;
  }

  function dispose(): void {
    clear();
    if (ctx) {
      ctx.close();
      ctx = null;
    }
  }

  return {
    ensureContext,
    enqueue,
    clear,
    get playing() { return _playing; },
    dispose,
  };
}
