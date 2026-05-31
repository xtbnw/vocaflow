// 浏览器端 TTS 控制器 — 连接本地语音网关，管理 TTS session 生命周期
// 不自行切句、不攒句；原始 message_delta 直接转发
//
// 状态机：
//   idle → connecting → starting → playing → finishing → idle
//                                                ↘ cancelling → idle
//
// 网关约束：同一连接只允许一个活跃 session。
// cancel 后必须等待 canceled，finish 后必须等待 ended，才能发送下一轮 start。

import { parseServerMessage, type VoiceGatewayServerMessage } from "./voiceGatewayProtocol";
import type { PcmPlaybackQueue } from "./pcmPlayer";

// -- WebSocket 工厂（便于测试注入） --

export type WsFactory = (url: string) => TtsWebSocket;

export interface TtsWebSocket {
  send(data: string | ArrayBuffer): void;
  close(): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  readyState: number;
}

const WS_OPEN = 1;
const READY_TIMEOUT_MS = 15000;

function realWsFactory(url: string): TtsWebSocket {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  return {
    send: (data) => { if (ws.readyState === WS_OPEN) ws.send(data); },
    close: () => ws.close(),
    addEventListener: (type, listener) => ws.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) => ws.removeEventListener(type, listener as EventListener),
    get readyState() { return ws.readyState; },
  };
}

// -- 类型 --

type TurnPhase = "idle" | "connecting" | "starting" | "playing" | "finishing" | "cancelling";

interface QueuedTurn {
  requestId: string;
  pendingTexts: string[];
  finishRequested: boolean;
  readyResolve: () => void;
  readyReject: (err: Error) => void;
  readyTimer: ReturnType<typeof setTimeout> | null;
}

// -- 控制器 --

export class TtsController {
  private ws: TtsWebSocket | null = null;
  private queue: PcmPlaybackQueue;
  private onError: (message: string) => void;
  private wsFactory: WsFactory;

  // 连接级
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  // 当前轮次
  private phase: TurnPhase = "idle";
  private requestId: string | null = null;
  private pendingTexts: string[] = [];
  private finishRequested = false;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  // 排队中的下一轮（等待当前 session 结束时发送）
  private queuedTurn: QueuedTurn | null = null;

  private disposed = false;
  private voiceError: string | null = null;

  constructor(
    queue: PcmPlaybackQueue,
    onError: (message: string) => void,
    wsFactory?: WsFactory,
  ) {
    this.queue = queue;
    this.onError = onError;
    this.wsFactory = wsFactory ?? realWsFactory;
  }

  /** 当前语音层错误（不覆盖 Agent 文字错误）。null 表示正常。 */
  get currentVoiceError(): string | null {
    return this.voiceError;
  }

  private setVoiceError(msg: string): void {
    this.voiceError = msg;
    this.onError(msg);
  }

  private clearVoiceError(): void {
    this.voiceError = null;
  }

  // -- 连接管理 --

  private ensureConnection(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("TtsController disposed"));
    if (this.connected && this.ws) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const url = process.env.NEXT_PUBLIC_VOICE_GATEWAY_URL ?? "ws://localhost:3101";

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = this.wsFactory(url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        // 等待网关发送 connected
      });

      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          let msg: VoiceGatewayServerMessage;
          try {
            msg = parseServerMessage(JSON.parse(event.data));
          } catch {
            this.setVoiceError("语音网关返回了无效消息");
            return;
          }

          if (msg.type === "connected") {
            this.connected = true;
            this.clearVoiceError();
            resolve();
            this.onConnected();
            return;
          }
          this.handleServerMessage(msg);
        } else if (event.data instanceof ArrayBuffer) {
          this.queue.enqueue(event.data);
        }
      });

      ws.addEventListener("error", () => {
        this.setVoiceError("语音网关连接失败");
        if (!this.connected) {
          this.connectPromise = null;
          reject(new Error("WebSocket connection error"));
        }
      });

      ws.addEventListener("close", () => {
        this.connected = false;
        this.connectPromise = null;
        this.ws = null;
        if (this.phase !== "idle") {
          this.setVoiceError("语音网关连接断开");
          this.releaseTurn("error");
        }
      });
    });

    return this.connectPromise;
  }

  /** 收到 connected 后：发送当前轮次的 start */
  private onConnected(): void {
    if (this.phase === "connecting" && this.requestId) {
      this.phase = "starting";
      this.sendClient({ type: "start", requestId: this.requestId });
      this.startReadyTimer();
    }
  }

  private waitForConnection(requestId: string, reject: (err: Error) => void): void {
    this.ensureConnection()
      .then(() => this.onConnected())
      .catch((err) => {
        if (this.phase === "connecting" && this.requestId === requestId) {
          this.phase = "idle";
          this.requestId = null;
          this.pendingTexts = [];
          this.clearReadyTimer();
          reject(err);
        }
      });
  }

  // -- 消息发送 --

  private sendClient(msg: { type: string; requestId?: string | null; text?: string }): void {
    if (this.ws?.readyState === WS_OPEN) {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(msg)) {
        if (v !== null) clean[k] = v;
      }
      this.ws.send(JSON.stringify(clean));
    }
  }

  // -- 超时 --

  private startReadyTimer(): void {
    this.clearReadyTimer();
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      if (this.phase === "starting") {
        this.setVoiceError("TTS 服务响应超时");
        // 取消当前 session
        if (this.requestId) {
          this.sendClient({ type: "cancel", requestId: this.requestId });
        }
        this.phase = "cancelling";
        this.pendingTexts = [];
        if (this.readyReject) {
          this.readyReject(new Error("Ready timeout"));
          this.readyResolve = null;
          this.readyReject = null;
        }
      }
    }, READY_TIMEOUT_MS);
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  // -- 服务器消息处理 --

  private handleServerMessage(msg: VoiceGatewayServerMessage): void {
    // 过滤旧轮次消息
    if (msg.type === "ready" || msg.type === "ended" || msg.type === "canceled") {
      if (msg.requestId !== this.requestId) return;
    }
    if (msg.type === "error" && msg.requestId && msg.requestId !== this.requestId) {
      return;
    }

    switch (msg.type) {
      case "ready":
        this.onReady();
        break;
      case "ended":
        this.onEnded();
        break;
      case "canceled":
        this.onCanceled();
        break;
      case "error":
        this.onServerError(msg.message);
        break;
    }
  }

  private onReady(): void {
    if (this.phase !== "starting") return;

    this.clearReadyTimer();
    this.clearVoiceError();

    // 发送排队中的文本
    const texts = this.pendingTexts;
    this.pendingTexts = [];

    if (texts.length > 0) {
      for (const text of texts) {
        this.sendClient({ type: "text_delta", requestId: this.requestId!, text });
      }
    }

    if (this.finishRequested) {
      // 文本已全部发送，直接 finish
      this.finishRequested = false;
      this.sendClient({ type: "finish", requestId: this.requestId! });
      this.phase = "finishing";
    } else {
      this.phase = "playing";
    }

    if (this.readyResolve) {
      this.readyResolve();
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  private onEnded(): void {
    if (this.phase === "finishing") {
      this.releaseTurn("ended");
    }
  }

  private onCanceled(): void {
    if (this.phase === "cancelling") {
      this.releaseTurn("canceled");
    }
  }

  private onServerError(message: string): void {
    this.setVoiceError(message);
    this.releaseTurn("error");
  }

  // -- 轮次释放与排队处理 --

  private releaseTurn(reason: "ended" | "canceled" | "error"): void {
    this.clearReadyTimer();
    this.pendingTexts = [];
    this.finishRequested = false;

    if (this.readyReject && reason !== "ended") {
      this.readyReject(new Error(reason));
    }
    this.readyResolve = null;
    this.readyReject = null;

    this.phase = "idle";
    this.requestId = null;

    // 处理排队中的下一轮
    const queued = this.queuedTurn;
    this.queuedTurn = null;
    if (queued) {
      this.startQueuedTurn(queued);
    }
  }

  private startQueuedTurn(turn: QueuedTurn): void {
    this.requestId = turn.requestId;
    this.pendingTexts = turn.pendingTexts;
    this.finishRequested = turn.finishRequested;
    this.readyResolve = turn.readyResolve;
    this.readyReject = turn.readyReject;
    this.readyTimer = turn.readyTimer;

    if (this.connected) {
      this.phase = "starting";
      this.sendClient({ type: "start", requestId: this.requestId! });
      // readyTimer was already set when the turn was queued
    } else {
      this.phase = "connecting";
      this.ensureConnection().catch(() => {
        if (this.readyReject) {
          this.readyReject(new Error("Connection failed"));
          this.readyResolve = null;
          this.readyReject = null;
        }
        this.phase = "idle";
        this.requestId = null;
        this.pendingTexts = [];
      });
    }
  }

  // -- 公开 API --

  /**
   * 开始新 TTS 轮次。
   * 立即创建本地轮次（requestId + pendingTexts 缓冲），
   * 等 WebSocket connected 后发送 start，收到匹配的 ready 后 resolve。
   */
  async start(): Promise<void> {
    if (this.disposed) throw new Error("TtsController disposed");

    const requestId = crypto.randomUUID();

    return new Promise<void>((resolve, reject) => {
      // 清除旧的排队轮次（superseded）
      if (this.queuedTurn) {
        this.clearQueuedTurn("superseded");
      }

      // 根据当前 phase 决定行为
      switch (this.phase) {
        case "idle":
          // 直接开始新轮次
          this.beginTurn(requestId, resolve, reject);
          if (this.connected) {
            this.onConnected();
            break;
          }
          this.waitForConnection(requestId, reject);
          break;

        case "connecting":
          // 替换当前正在连接的轮次
          this.abortCurrentTurn("superseded");
          this.beginTurn(requestId, resolve, reject);
          this.waitForConnection(requestId, reject);
          break;

        case "starting":
        case "playing":
          // 取消旧 session，排队新轮次
          this.sendCancelForCurrent();
          this.phase = "cancelling";
          this.queuedTurn = this.createQueuedTurn(requestId, resolve, reject);
          break;

        case "finishing":
        case "cancelling":
          // 已在等待结束，直接排队
          this.queuedTurn = this.createQueuedTurn(requestId, resolve, reject);
          break;
      }
    });
  }

  private beginTurn(
    requestId: string,
    resolve: () => void,
    reject: (err: Error) => void,
  ): void {
    this.requestId = requestId;
    this.pendingTexts = [];
    this.finishRequested = false;
    this.readyResolve = resolve;
    this.readyReject = reject;
    this.phase = "connecting";
    this.clearVoiceError();
  }

  private createQueuedTurn(
    requestId: string,
    resolve: () => void,
    reject: (err: Error) => void,
  ): QueuedTurn {
    // readyTimer 现在就启动：如果排队太久也报超时
    const timer = setTimeout(() => {
      if (this.queuedTurn?.requestId === requestId) {
        this.clearQueuedTurn("timeout");
        this.setVoiceError("TTS 服务响应超时");
        reject(new Error("Ready timeout"));
      }
    }, READY_TIMEOUT_MS);

    return {
      requestId,
      pendingTexts: [],
      finishRequested: false,
      readyResolve: resolve,
      readyReject: reject,
      readyTimer: timer,
    };
  }

  private sendCancelForCurrent(): void {
    if (this.requestId) {
      this.sendClient({ type: "cancel", requestId: this.requestId });
    }
    this.queue.clear();
    this.pendingTexts = [];
    this.finishRequested = false;
    this.clearReadyTimer();
    if (this.readyReject) {
      this.readyReject(new Error("Cancelled"));
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  private abortCurrentTurn(reason: "superseded"): void {
    this.clearReadyTimer();
    this.pendingTexts = [];
    this.finishRequested = false;
    if (this.readyReject) {
      this.readyReject(new Error(reason));
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  private clearQueuedTurn(reason: "superseded" | "timeout"): void {
    if (!this.queuedTurn) return;
    if (this.queuedTurn.readyTimer) {
      clearTimeout(this.queuedTurn.readyTimer);
    }
    if (reason === "superseded") {
      this.queuedTurn.readyReject(new Error("Superseded"));
    }
    this.queuedTurn = null;
  }

  /** 发送原始增量文本。ready 前缓存在本地，ready 后直接发送。 */
  appendText(text: string): void {
    // 如果有排队轮次，追加到排队轮次
    if (this.queuedTurn) {
      this.queuedTurn.pendingTexts.push(text);
      return;
    }

    if (!this.requestId) return;

    if (this.phase === "playing") {
      this.sendClient({ type: "text_delta", requestId: this.requestId, text });
    } else {
      // connecting 或 starting：缓存
      this.pendingTexts.push(text);
    }
  }

  /** 结束当前 TTS session，通知网关文本发送完毕。 */
  finish(): void {
    // 如果有排队轮次，标记排队轮次的 finish
    if (this.queuedTurn) {
      this.queuedTurn.finishRequested = true;
      return;
    }

    if (!this.requestId) return;

    if (this.phase === "connecting" || this.phase === "starting") {
      // ready 前调用：记录意图，ready 后处理
      this.finishRequested = true;
    } else if (this.phase === "playing") {
      this.sendClient({ type: "finish", requestId: this.requestId });
      this.phase = "finishing";
    }
  }

  /** 取消当前 TTS session：清空本地音频队列 + 通知网关。 */
  cancel(): void {
    // 清除排队中的轮次
    if (this.queuedTurn) {
      this.clearQueuedTurn("superseded");
    }

    this.queue.clear();

    if (this.phase === "idle") return;

    if (this.phase === "connecting") {
      // 尚未发送 start，直接清理本地状态
      this.clearReadyTimer();
      this.pendingTexts = [];
      if (this.readyReject) {
        this.readyReject(new Error("Cancelled"));
        this.readyResolve = null;
        this.readyReject = null;
      }
      this.phase = "idle";
      this.requestId = null;
      return;
    }

    // starting / playing / finishing / cancelling：通知网关取消
    if (this.requestId) {
      this.sendClient({ type: "cancel", requestId: this.requestId });
    }
    this.phase = "cancelling";
    this.pendingTexts = [];
    this.clearReadyTimer();
    if (this.readyReject) {
      this.readyReject(new Error("Cancelled"));
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  /** 释放 TTS 控制器：关闭 WebSocket 连接 + 清理音频队列。 */
  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.queue.dispose();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connectPromise = null;
  }

  /** 恢复 AudioContext（需在用户手势链路中调用）。 */
  async ensureContext(): Promise<void> {
    await this.queue.ensureContext();
  }
}
