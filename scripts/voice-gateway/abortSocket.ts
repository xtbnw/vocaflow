// WebSocket 安全中止工具 — 纯函数，可独立单元测试

/** 与 abortSocketSafely 协作所需的最小 socket 接口 */
export interface AbortableSocket {
  once(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
  close(): void;
}

/**
 * 安全中止 WebSocket 连接。
 * - 在 close 前注册兜底 error listener，防止 CONNECTING 状态下 close 触发的异步 error 无处理
 * - 调用 socket.close()
 * - 调用 cleanup() 移除所有业务 listener 和 timer
 * - 拒绝 Promise
 *
 * 调用方负责 settled guard —— 本函数不做去重。
 */
export function abortSocketSafely(
  socket: AbortableSocket,
  cleanup: () => void,
  reject: (err: Error) => void,
  reason: Error,
): void {
  // 必须在 close 前注册：CONNECTING 状态下 close 会触发异步 error
  socket.once("error", () => {});
  socket.close();
  cleanup();
  reject(reason);
}
