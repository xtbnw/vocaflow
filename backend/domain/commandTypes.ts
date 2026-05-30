export type ParseResult = ToolCallResult | MessageResult;

export interface ToolCallResult {
  kind: "tool_call";
  tool: string;
  arguments: Record<string, unknown>;
  confidence?: number;
}

export interface MessageResult {
  kind: "message";
  content: string;
}
