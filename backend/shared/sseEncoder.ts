import type { AgentStreamEvent } from "../domain/agentRuntime";

/**
 * 将单个 AgentStreamEvent 编码为 SSE 格式字符串。
 * 每个事件包含 event: 行、data: 行，以空行结束。
 * message_delta 高频事件也显式声明 event: 行，保证协议一致性。
 */
export function encodeSSE(event: AgentStreamEvent): string {
  const data = JSON.stringify(event);
  return `event: ${event.type}\ndata: ${data}\n\n`;
}

/**
 * 将 AgentStreamEvent 异步迭代器转换为 SSE 字节流。
 * 返回 web ReadableStream<Uint8Array>，可直接用于 Response body。
 *
 * pull 模式：start 中创建 iterator，每次 pull 读取一条事件并 enqueue。
 * cancel 中调用 iterator.return?.() 作为 best-effort 清理。
 */
export function sseStream(
  events: AsyncIterable<AgentStreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<AgentStreamEvent> | null = null;

  return new ReadableStream<Uint8Array>({
    start() {
      iterator = events[Symbol.asyncIterator]();
    },
    async pull(controller) {
      if (!iterator) {
        controller.close();
        return;
      }
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeSSE(value)));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      if (iterator) {
        const it = iterator as AsyncIterator<AgentStreamEvent> & {
          return?(value?: unknown): Promise<IteratorResult<AgentStreamEvent>>;
        };
        try { await it.return?.(); } catch { /* best-effort */ }
        iterator = null;
      }
    },
  });
}
