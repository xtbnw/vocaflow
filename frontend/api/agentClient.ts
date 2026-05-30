import type { SessionMessage } from "@/backend/domain/sessionTypes";
import type { PendingAction } from "@/backend/app/types/pendingAction";

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
