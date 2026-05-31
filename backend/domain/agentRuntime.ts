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
   * 旁路 SSE 路由仅依赖此方法，不感知内部实现细节。
   */
  invoke(message: string): Promise<{ messages: unknown[] }>;
}
