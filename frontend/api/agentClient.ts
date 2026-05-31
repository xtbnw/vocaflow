import type { AgentStreamEvent } from "@/backend/domain/agentRuntime";

/**
 * 调用 POST /api/agent/resume 并逐事件回调 onEvent。
 * 返回 Promise<void>，流结束时 resolve，网络/解析异常时 reject。
 * 传入 signal 可中断请求与流读取。
 */
export async function resumeMessage(
  threadId: string,
  decision: "approve" | "reject",
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch("/api/agent/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, decision }),
      signal,
    });

    if (!res.ok) {
      let errorMessage = "请求失败";
      try {
        const body = await res.json();
        errorMessage = body.message ?? errorMessage;
      } catch { /* ignore */ }
      throw new Error(errorMessage);
    }

    if (!res.body) {
      throw new Error("响应体为空");
    }

    await readSSEStream(res.body, onEvent, signal);
  } catch (err) {
    if (isAbortError(err)) return;
    throw err;
  }
}

async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { value, done } = await reader.read();
      if (done) break;
      if (signal?.aborted) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as AgentStreamEvent;
            onEvent(event);
          } catch {
            // 跳过无法解析的事件
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function streamMessage(
  text: string,
  threadId: string | null,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch("/api/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, threadId }),
      signal,
    });

    if (!res.ok) {
      let errorMessage = "请求失败";
      try {
        const body = await res.json();
        errorMessage = body.message ?? errorMessage;
      } catch {
        // ignore parse error, use default
      }
      throw new Error(errorMessage);
    }

    if (!res.body) {
      throw new Error("响应体为空");
    }

    await readSSEStream(res.body, onEvent, signal);
  } catch (err) {
    if (isAbortError(err)) return;
    throw err;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
