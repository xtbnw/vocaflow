import type { ASRProvider } from "@/backend/domain/asrProvider";

/**
 * ASR provider backed by the browser Web Speech API.
 *
 * - continuous: true  — keeps listening across pauses
 * - interimResults: true — fires partial results so the UI can show live transcription
 * - lang: zh-CN — MVP Chinese-first; can be parameterized later
 */
export class WebSpeechASRProvider implements ASRProvider {
  onPartialResult: ((text: string) => void) | null = null;
  onFinalResult: ((text: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private recognition: SpeechRecognition | null = null;
  private started = false;

  isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  start(): void {
    if (!this.isSupported()) {
      this.onError?.("当前浏览器不支持语音识别");
      return;
    }

    if (this.started) return;

    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition!;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0]?.transcript ?? "";
        } else {
          interim += result[0]?.transcript ?? "";
        }
      }

      if (final) {
        this.onFinalResult?.(final);
      }
      if (interim) {
        this.onPartialResult?.(interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const message = asrErrorMessage(event.error, event.message);
      this.onError?.(message);
    };

    recognition.onend = () => {
      // If we haven't been explicitly stopped, restart (continuous mode resilience)
      if (this.started) {
        try {
          recognition.start();
        } catch {
          this.started = false;
        }
      }
    };

    this.recognition = recognition;
    this.started = true;
    recognition.start();
  }

  stop(): void {
    this.started = false;
    if (this.recognition) {
      this.recognition.onend = null; // prevent auto-restart
      this.recognition.stop();
      this.recognition = null;
    }
  }
}

function asrErrorMessage(error: string, message: string): string {
  switch (error) {
    case "no-speech":
      return "未检测到语音，请重试";
    case "aborted":
      return "语音识别已中止";
    case "audio-capture":
      return "未找到麦克风设备";
    case "network":
      return "网络连接失败，请检查网络";
    case "not-allowed":
      return "麦克风权限未授权，请在浏览器设置中允许麦克风访问";
    case "service-not-allowed":
      return "语音识别服务不可用";
    case "bad-grammar":
      return "语音识别语法错误";
    case "language-not-supported":
      return "当前语言不支持";
    default:
      return message || `语音识别错误: ${error}`;
  }
}
