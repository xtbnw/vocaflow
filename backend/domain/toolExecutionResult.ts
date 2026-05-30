export interface ToolExecutionResult {
  kind: "execution";
  success: boolean;
  tool: string;
  message: string;
  data?: unknown;
}
