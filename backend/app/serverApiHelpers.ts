import {
  SessionMessageSchema,
  type SessionMessage,
} from "../domain/sessionTypes";

export function parseHistory(messages: unknown): SessionMessage[] {
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((message) => {
    const parsed = SessionMessageSchema.safeParse(message);
    return parsed.success ? [parsed.data as SessionMessage] : [];
  });
}

export function createParserContext() {
  return {
    currentTime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
