export type ParseResult =
  | ToolCallResult
  | ClarificationResult
  | ChatResult
  | UnknownResult
  | FinishResult;

export interface ToolCallResult {
  kind: "tool_call";
  tool: string;
  arguments: Record<string, unknown>;
  confidence?: number;
}

export interface ClarificationResult {
  kind: "clarification";
  clarificationQuestion: string;
  missingFields?: string[];
}

export interface ChatResult {
  kind: "chat";
  message: string;
}

export interface UnknownResult {
  kind: "unknown";
  reason?: string;
}

export interface FinishResult {
  kind: "finish";
  message: string;
}
