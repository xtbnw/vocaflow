import type { ASRProvider } from "../../domain/asrProvider";

/**
 * No-op ASR provider used as a fallback when Web Speech API is unavailable.
 * All methods are safe to call but produce no side effects.
 */
export class NoopASRProvider implements ASRProvider {
  onPartialResult: ((text: string) => void) | null = null;
  onFinalResult: ((text: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  start(): void {
    this.onError?.("当前浏览器不支持语音识别");
  }

  stop(): void {
    // no-op
  }

  isSupported(): boolean {
    return false;
  }
}
