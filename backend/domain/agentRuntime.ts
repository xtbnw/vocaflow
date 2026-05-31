/** 应用层稳定 SSE 事件协议，不暴露 LangChain 内部事件到前端。 */
export type AgentStreamEvent =
  | { type: "thread"; threadId: string }
  | { type: "message_delta"; messageId: string; text: string }
  | { type: "tool_started"; callId: string; tool: string; arguments: unknown }
  | { type: "tool_finished"; callId: string; tool: string; result: unknown }
  | { type: "tool_error"; callId: string; tool: string; message: string }
  | { type: "done" }
  | { type: "error"; code: string; message: string };

/**
 * 稳定的 Agent 运行时端口。
 * 不泄漏 Deep Agents / LangGraph 具体类型到 API Route 和前端。
 * 后续旁路接入仅依赖此接口。
 */
export interface AgentRuntime {
  /** 运行时标识，用于日志和诊断。 */
  readonly kind: string;

  /** 当前使用的模型名称。 */
  readonly model: string;

  /**
   * 接收一条用户消息并返回 agent 最终响应。
   * threadId 用于标识对话线程，同一 threadId 可延续上下文。
   * 旁路 SSE 路由仅依赖此方法，不感知内部实现细节。
   */
  invoke(message: string, threadId: string): Promise<{ messages: unknown[] }>;

  /**
   * 以 SSE 兼容的异步迭代器流式返回 agent 事件。
   * 首个事件固定为 thread，结束时发送 done。
   * 出错时发送 error 事件并终止迭代。
   */
  stream(message: string, threadId: string, signal?: AbortSignal): AsyncIterable<AgentStreamEvent>;

  /**
   * 删除指定线程的 checkpoint 状态。
   * 删除后该 threadId 不再可恢复历史上下文。
   */
  deleteThread(threadId: string): Promise<void>;
}
