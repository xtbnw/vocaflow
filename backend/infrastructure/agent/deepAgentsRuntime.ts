import { HumanMessage } from "langchain";
import { ChatDeepSeek } from "@langchain/deepseek";
import { createDeepAgent } from "deepagents";
import type { DeepAgent } from "deepagents";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { AgentRuntime } from "../../domain/agentRuntime";
import type { CalendarRepository } from "../../domain/calendarRepository";
import {
  QueryEventsArgsSchema,
  type QueryEventsArgs,
} from "../../domain/calendarTypes";
import { queryEventsHandler } from "../../app/calendarToolHandlers";

export interface DeepAgentsRuntimeDeps {
  createLLM?: () => ChatDeepSeek;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createAgent?: (llm: ChatDeepSeek, tools: StructuredToolInterface[]) => DeepAgent;
}

/** 默认 ChatDeepSeek 配置，单元测试可基于此验证。 */
export const DEFAULT_LLM_CONFIG = {
  model: "deepseek-v4-pro" as const,
  apiKey: process.env.DEEPSEEK_API_KEY,
  modelKwargs: {
    thinking: { type: "disabled" as const },
  },
};

/**
 * 创建 query_events 工具，复用现有 QueryEventsArgsSchema 和 queryEventsHandler。
 * 工具描述明确告诉模型：何时查询、时间范围字段如何填写、关键词可选用途。
 */
export function createQueryEventsTool(repository: CalendarRepository) {
  const handler = queryEventsHandler(repository);

  return tool(
    async (args: QueryEventsArgs) => {
      const result = await handler(args);
      return JSON.stringify(result);
    },
    {
      name: "query_events",
      description:
        "查询指定时间范围内的日程事件。" +
        "当用户询问某段时间有什么安排、是否空闲、日程列表等需要查看日历信息时调用此工具。" +
        "rangeStartAt 和 rangeEndAt 为 ISO 8601 格式的日期时间字符串（含时区），" +
        "表示查询时间区间的起止。" +
        "keyword 为可选关键词，用于在日程标题和备注中进行文本过滤。",
      schema: QueryEventsArgsSchema,
    },
  );
}

/**
 * Deep Agents 运行时。
 *
 * 注册只读 query_events 工具，不注册 create_event 或 delete_event。
 * 使用 Deep Agents 默认 StateBackend（thread 内临时虚拟文件，不接触宿主文件系统）。
 * Tavily、sandbox、shell、宿主文件系统访问通过默认 StateBackend 保持隔离。
 * 通过 Deps 注入支持单元测试（测试替身），默认走正式链路。
 */
export class DeepAgentsRuntime implements AgentRuntime {
  readonly kind = "deepagents";
  readonly model = "deepseek-v4-pro";

  private _agent: DeepAgent;

  constructor(repository: CalendarRepository, deps?: DeepAgentsRuntimeDeps) {
    const llm = deps?.createLLM
      ? deps.createLLM()
      : new ChatDeepSeek(DEFAULT_LLM_CONFIG);

    const tools = [createQueryEventsTool(repository)];

    this._agent = deps?.createAgent
      ? deps.createAgent(llm, tools)
      : // 接受 Deep Agents 默认内置 general-purpose subagent 和 task 工具，
        // 不注册自定义 subagent。内置 subagent 与主 agent 共享同一工具集，
        // 仅能调用 query_events，不会获得额外宿主访问能力。
        createDeepAgent({
          model: llm,
          // createDeepAgent 的 tools 参数期望与 LangChain DynamicStructuredTool 精确匹配；
          // createQueryEventsTool 返回的 LangChain tool 实例与之兼容但类型推断受限。
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: tools as any,
          systemPrompt:
            "你是一个日历语音助手。你可以通过 query_events 工具查询用户的日程。" +
            "当用户询问日程安排、空闲时间或需要查看日历时，请先调用 query_events。" +
            "用中文回复用户，保持回复简洁清晰。",
        });
  }

  /** 获取内部 DeepAgent 实例（供后续任务扩展）。 */
  get agent(): DeepAgent {
    return this._agent;
  }

  async invoke(message: string): Promise<{ messages: unknown[] }> {
    const result = await this._agent.invoke({
      messages: [new HumanMessage(message)],
    });

    const messages = (result.messages ?? []) as unknown[];
    return { messages };
  }
}
