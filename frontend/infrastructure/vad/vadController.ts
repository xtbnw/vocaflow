// Browser VAD controller — uses getUserMedia + Web Audio AnalyserNode
// to detect when the user starts speaking during TTS playback.
//
// This is a best-effort heuristic; it does NOT claim to fully reject
// speaker echo.  The absolute threshold and noise-floor multiplier are
// exposed as named constants in vadDetector.ts for easy tuning.

import {
  createVADState,
  evaluateVADSample,
  computeRMS,
  VAD_SAMPLE_INTERVAL_MS,
  DEFAULT_VAD_CONFIG,
  type VADConfig,
  type VADState,
} from "./vadDetector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VADTriggerCallback = () => void;
export type VADErrorCallback = (message: string) => void;

/** Injectable media dependencies so tests can supply fakes. */
export interface VADMediaDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(sampleRate: number): AudioContext;
}

const defaultMediaDeps: VADMediaDeps = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createAudioContext: (sampleRate) => new AudioContext({ sampleRate }),
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class VADController {
  private config: VADConfig;
  private onTriggered: VADTriggerCallback;
  private onError: VADErrorCallback;
  private media: VADMediaDeps;

  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: VADState = createVADState();

  /**
   * Generation token incremented on every start/stop.
   * Async start captures a snapshot; if the generation changed by the time
   * an await resolves, the start is stale and must self-abort.
   */
  private generation = 0;
  private running = false;
  private disposed = false;

  constructor(
    onTriggered: VADTriggerCallback,
    onError: VADErrorCallback,
    config?: Partial<VADConfig>,
    media?: VADMediaDeps,
  ) {
    this.onTriggered = onTriggered;
    this.onError = onError;
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    this.media = media ?? defaultMediaDeps;
  }

  /** Whether the VAD is currently polling the microphone. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Start VAD monitoring.  Requests mic access, creates an AnalyserNode,
   * and begins polling every 50 ms.
   *
   * If mic permission is denied or an error occurs, calls `onError` and
   * does NOT start — the caller should fall back to manual-only barge-in.
   *
   * If `stop()` or `dispose()` is called while this method is still
   * awaiting getUserMedia, the start is discarded and all resources
   * acquired so far are released.
   */
  async start(): Promise<void> {
    if (this.disposed || this.running) return;

    this.running = true;
    const gen = ++this.generation;

    // -- acquire microphone stream --
    let stream: MediaStream;
    try {
      stream = await this.media.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      // Stale request (stopped / disposed / superseded while awaiting) —
      // silently exit without touching running or onError.
      if (gen !== this.generation) return;

      this.running = false;
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "麦克风权限未授权，自动打断已降级为手动模式"
          : `无法获取麦克风: ${err instanceof Error ? err.message : "未知错误"}`;
      this.onError(message);
      return;
    }

    // Check whether we were stopped while awaiting getUserMedia
    if (gen !== this.generation || !this.running) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // -- create AudioContext --
    let audioContext: AudioContext;
    try {
      audioContext = this.media.createAudioContext(24000);
    } catch {
      stream.getTracks().forEach((t) => t.stop());

      // Stale — silently release
      if (gen !== this.generation || !this.running) return;

      this.running = false;
      this.onError("浏览器不支持 AudioContext，自动打断已降级为手动模式");
      return;
    }

    // Check again after AudioContext creation
    if (gen !== this.generation || !this.running) {
      stream.getTracks().forEach((t) => t.stop());
      audioContext.close();
      return;
    }

    // -- safe initialisation boundary: analyser, media source, timer --
    let analyser: AnalyserNode | undefined;
    let sourceNode: MediaStreamAudioSourceNode | undefined;

    try {
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNode.connect(analyser);
    } catch {
      // Release partially-initialised resources
      try { sourceNode?.disconnect(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      audioContext.close();

      if (gen === this.generation && this.running) {
        this.running = false;
        this.onError("VAD 初始化失败");
      }
      return;
    }

    // -- all resources acquired — commit to instance --
    this.stream = stream;
    this.audioContext = audioContext;
    this.analyser = analyser;
    this.sourceNode = sourceNode;

    this.state = createVADState();

    const buffer = new Float32Array(this.analyser.fftSize);

    this.timer = setInterval(() => {
      if (!this.analyser || !this.running) return;

      this.analyser.getFloatTimeDomainData(buffer);
      const rms = computeRMS(buffer);
      const result = evaluateVADSample(rms, this.state, this.config);
      this.state = result.state;

      if (result.triggered) {
        // Fire asynchronously so the caller doesn't need to worry about
        // re-entrancy from inside setInterval.
        this.onTriggered();
      }
    }, VAD_SAMPLE_INTERVAL_MS);
  }

  /**
   * Stop VAD monitoring and release all resources (timer, audio nodes,
   * microphone stream).  Safe to call even if not running.
   *
   * Increments the generation token so any in-flight `start()` awaiting
   * getUserMedia will self-abort.
   */
  stop(): void {
    this.running = false;
    this.generation++;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch { /* already disconnected */ }
      this.sourceNode = null;
    }

    if (this.analyser) {
      this.analyser = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      try { this.audioContext.close(); } catch { /* already closed */ }
      this.audioContext = null;
    }
  }

  /**
   * Full cleanup.  Safe to call multiple times.
   */
  dispose(): void {
    this.stop();
    this.disposed = true;
  }
}
