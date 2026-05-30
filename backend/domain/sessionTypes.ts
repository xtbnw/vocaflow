import { z } from "zod";

// -- Session status --

export const SessionStatusSchema = z.enum(["active", "completed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// -- Message kinds --

export type SessionMessage = UserMessage | AssistantMessage | ToolMessage;

export interface UserMessage {
  kind: "user";
  id: string;
  text: string;
  timestamp: string;
}

export interface AssistantMessage {
  kind: "assistant";
  id: string;
  content: string;
  resultKind: "clarification" | "chat" | "unknown" | "tool_call" | "finish";
  tool?: string;
  arguments?: Record<string, unknown>;
  timestamp: string;
}

export interface ToolMessage {
  kind: "tool";
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  success: boolean;
  message: string;
  timestamp: string;
}

// -- Session --

export interface Session {
  id: string;
  messages: SessionMessage[];
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

// -- Zod schemas for storage validation --

export const UserMessageSchema = z.object({
  kind: z.literal("user"),
  id: z.string().min(1),
  text: z.string(),
  timestamp: z.string(),
});

export const AssistantMessageSchema = z.object({
  kind: z.literal("assistant"),
  id: z.string().min(1),
  content: z.string(),
  resultKind: z.enum(["clarification", "chat", "unknown", "tool_call", "finish"]),
  tool: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
});

export const ToolMessageSchema = z.object({
  kind: z.literal("tool"),
  id: z.string().min(1),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  success: z.boolean(),
  message: z.string(),
  timestamp: z.string(),
});

export const SessionMessageSchema = z.discriminatedUnion("kind", [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export const SessionSchema = z.object({
  id: z.string().min(1),
  messages: z.array(SessionMessageSchema),
  status: SessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
