import type {
  Session,
  SessionMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
} from "../domain/sessionTypes";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSession(): Session {
  const now = new Date().toISOString();
  return {
    id: newId(),
    messages: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export function addMessage(
  session: Session,
  message: SessionMessage,
): Session {
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: new Date().toISOString(),
  };
}

export function endSession(session: Session): Session {
  return {
    ...session,
    status: "completed",
    updatedAt: new Date().toISOString(),
  };
}

export function makeUserMessage(text: string): UserMessage {
  return {
    kind: "user",
    id: newId(),
    text,
    timestamp: new Date().toISOString(),
  };
}

export function makeAssistantMessage(
  content: string,
  resultKind: AssistantMessage["resultKind"],
  tool?: string,
  args?: Record<string, unknown>,
): AssistantMessage {
  return {
    kind: "assistant",
    id: newId(),
    content,
    resultKind,
    tool,
    arguments: args,
    timestamp: new Date().toISOString(),
  };
}

export function makeToolMessage(
  toolName: string,
  args: Record<string, unknown>,
  success: boolean,
  message: string,
): ToolMessage {
  return {
    kind: "tool",
    id: newId(),
    toolName,
    arguments: args,
    success,
    message,
    timestamp: new Date().toISOString(),
  };
}
