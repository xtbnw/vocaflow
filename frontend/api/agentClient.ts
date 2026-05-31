import type { SessionMessage } from "@/backend/domain/sessionTypes";
import type { PendingAction } from "@/backend/app/types/pendingAction";
import type { AgentStreamEvent } from "@/backend/domain/agentRuntime";

export interface AgentResponse {
  sessionId: string;
  messages: SessionMessage[];
  pendingAction?: PendingAction;
  eventsChanged?: boolean;
}

async function post(path: string, body: Record<string, unknown>): Promise<AgentResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Agent request failed");
  return (await res.json()) as AgentResponse;
}

export function sendMessage(sessionId: string | null, text: string): Promise<AgentResponse> {
  return post("/api/command", { sessionId, text });
}

export function confirmPendingAction(sessionId: string, pendingActionId: string): Promise<AgentResponse> {
  return post("/api/command/confirm", { sessionId, pendingActionId });
}

export function cancelPendingAction(sessionId: string, pendingActionId: string): Promise<AgentResponse> {
  return post("/api/command/cancel", { sessionId, pendingActionId });
}

/**
 * 调用 POST /api/agent/stream 并逐事件回调 onEvent。
 * 返回 Promise<void>，流结束时 resolve，网络/解析异常时 reject。
 * 传入 signal 可中断请求与流读取。
 */
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

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (signal?.aborted) break;

        const { value, done } = await reader.read();
        if (done) break;
        if (signal?.aborted) break;

        buffer += decoder.decode(value, { stream: true });

        // 按行解析 SSE：data: 行包含 JSON 事件
        const lines = buffer.split("\n");
        // 保留最后一段（可能不完整）在下一次循环中继续拼接
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as AgentStreamEvent;
              onEvent(event);
            } catch {
              // 跳过无法解析的事件（非致命，避免一行脏数据中断整个流）
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (err) {
    if (isAbortError(err)) return;
    throw err;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
