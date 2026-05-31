import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { HumanMessage } from "langchain";
import { ChatDeepSeek } from "@langchain/deepseek";
import { createDeepAgent } from "deepagents";
import type { DeepAgent } from "deepagents";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { Command, isGraphInterrupt } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { AgentRuntime, AgentStreamEvent, ToolReviewDecision, ToolReviewInterrupt } from "../../domain/agentRuntime";
import type { CalendarRepository } from "../../domain/calendarRepository";
import {
  QueryEventsArgsSchema,
  type QueryEventsArgs,
} from "../../domain/calendarTypes";
import { queryEventsHandler } from "../../app/calendarToolHandlers";
import { createCreateEventTool, createDeleteEventTool } from "./calendarWriteTools";

export interface DeepAgentsRuntimeDeps {
  createLLM?: () => ChatDeepSeek;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createAgent?: (llm: ChatDeepSeek, tools: StructuredToolInterface[]) => DeepAgent;
  /** 注入自定义 checkpointer（默认使用 data/vocaflow-checkpoints.sqlite）。 */
  getCheckpointer?: () => SqliteSaver;
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

function defaultCheckpointerPath(): string {
  return join(process.cwd(), "data", "vocaflow-checkpoints.sqlite");
}

function createDefaultCheckpointer(): SqliteSaver {
  const dbPath = defaultCheckpointerPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode=WAL");
  return new SqliteSaver(db);
}

/**
 * Deep Agents 运行时。
 *
 * 注册 query_events、create_event、delete_event 三个业务工具。
 * 写操作（create/delete）内嵌 interrupt 审批流程，需前端 confirm/resume 后执行。
 * 使用 Deep Agents 默认 StateBackend（thread 内临时虚拟文件，不接触宿主文件系统）。
 * Tavily、sandbox、shell、宿主文件系统访问通过默认 StateBackend 保持隔离。
 * 通过 Deps 注入支持单元测试（测试替身），默认走正式链路。
 * 通过 SqliteSaver checkpoint 持久化 thread 状态，支持同一 threadId 延续上下文。
 */
export class DeepAgentsRuntime implements AgentRuntime {
  readonly kind = "deepagents";
  readonly model = "deepseek-v4-pro";

  private _agent: DeepAgent;
  private _checkpointer: SqliteSaver;

  constructor(repository: CalendarRepository, deps?: DeepAgentsRuntimeDeps) {
    const llm = deps?.createLLM
      ? deps.createLLM()
      : new ChatDeepSeek(DEFAULT_LLM_CONFIG);

    const tools: StructuredToolInterface[] = [
      createQueryEventsTool(repository),
      createCreateEventTool(repository),
      createDeleteEventTool(repository),
    ];

    this._checkpointer = deps?.getCheckpointer
      ? deps.getCheckpointer()
      : createDefaultCheckpointer();

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
          checkpointer: this._checkpointer,
          systemPrompt:
            "你是一个日历语音助手。你可以通过 query_events 工具查询用户的日程，" +
            "通过 create_event 工具创建新日程，通过 delete_event 工具删除日程。" +
            "当用户询问日程安排、空闲时间或需要查看日历时，请先调用 query_events。" +
            "创建和删除操作需要用户确认后才能执行。" +
            "用中文回复用户，保持回复简洁清晰。",
        });
  }

  /** 获取内部 DeepAgent 实例（供后续任务扩展）。 */
  get agent(): DeepAgent {
    return this._agent;
  }

  async invoke(message: string, threadId: string): Promise<{ messages: unknown[] }> {
    const result = await this._agent.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: threadId } },
    );

    const messages = (result.messages ?? []) as unknown[];
    return { messages };
  }

  async *stream(message: string, threadId: string, signal?: AbortSignal): AsyncIterable<AgentStreamEvent> {
    yield { type: "thread", threadId };
    yield* this._runStream(
      { messages: [new HumanMessage(message)] },
      threadId,
      signal,
    );
  }

  async *resume(decision: ToolReviewDecision, threadId: string, signal?: AbortSignal): AsyncIterable<AgentStreamEvent> {
    yield { type: "thread", threadId };
    yield* this._runStream(
      new Command({ resume: decision }),
      threadId,
      signal,
    );
  }

  /** 统一的事件流驱动，支持普通输入和 Command resume。 */
  private async *_runStream(
    input: { messages: HumanMessage[] } | Command,
    threadId: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    if (signal?.aborted) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventStream: any = undefined;
    let completed = false;
    let eventsChanged = false;

    try {
      eventStream = await this._agent.streamEvents(input, {
        configurable: { thread_id: threadId },
        version: "v3",
        ...(signal ? { signal } : {}),
      });

      if (signal?.aborted) {
        try { await eventStream.abort?.(new Error("Client disconnected")); } catch {}
        return;
      }

      const onAbort = () => {
        try { eventStream?.abort?.(new Error("Client disconnected")); } catch {}
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        let currentMessageId = "";
        const toolNames = new Map<string, string>();

        for await (const event of eventStream) {
          if (signal?.aborted) break;

          const method = event.method;
          const data = event.params.data as Record<string, unknown>;

          if (method === "messages") {
            const msgEvent = data.event as string;

            if (msgEvent === "message-start" && typeof data.id === "string") {
              currentMessageId = data.id;
              continue;
            }

            if (msgEvent === "content-block-delta") {
              const delta = data.delta as Record<string, unknown> | undefined;
              if (delta?.type === "text-delta" && typeof delta.text === "string" && delta.text.length > 0) {
                yield {
                  type: "message_delta",
                  messageId: currentMessageId,
                  text: delta.text,
                };
              }
              continue;
            }
          }

          if (method === "tools") {
            const toolEvent = data.event as string;
            const callId = (data.tool_call_id as string) ?? "";

            if (toolEvent === "tool-started") {
              const toolName = (data.tool_name as string) ?? "";
              if (callId) toolNames.set(callId, toolName);
              yield {
                type: "tool_started",
                callId,
                tool: toolName,
                arguments: data.input ?? {},
              };
              continue;
            }

            if (toolEvent === "tool-finished") {
              const tn = toolNames.get(callId) ?? "";
              yield {
                type: "tool_finished",
                callId,
                tool: tn,
                result: data.output,
              };
              // 检测写操作是否成功执行
              if (tn === "create_event" || tn === "delete_event") {
                try {
                  const parsed = typeof data.output === "string"
                    ? JSON.parse(data.output as string)
                    : data.output;
                  if (parsed?.action === "created" || parsed?.action === "deleted") {
                    eventsChanged = true;
                  }
                } catch { /* ignore parse errors */ }
              }
              continue;
            }

            if (toolEvent === "tool-error") {
              yield {
                type: "tool_error",
                callId,
                tool: toolNames.get(callId) ?? "",
                message: (data.message as string) ?? "工具执行失败",
              };
              continue;
            }
          }
        }

        // for-await 正常结束：检查 pending interrupt 再决定发送 done 还是 interrupt
        if (!signal?.aborted) {
          const review = await this._readPendingInterrupt(threadId);
          if (review) {
            yield { type: "interrupt", review };
            return;
          }
          completed = true;
          if (eventsChanged) {
            yield { type: "events_changed" };
          }
          yield { type: "done" };
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      // 捕获 interrupt() 抛出的 GraphInterrupt，提取 review payload
      if (isGraphInterrupt(err)) {
        const interrupts = (err as unknown as { interrupts?: Array<{ value: unknown }> }).interrupts;
        if (interrupts && interrupts.length > 0) {
          const value = interrupts[0].value;
          if (value && typeof value === "object" && (value as Record<string, unknown>).kind === "tool_review") {
            yield { type: "interrupt", review: value as ToolReviewInterrupt };
            return;
          }
        }
      }

      // GraphInterrupt 可能被内部捕获：尝试从 checkpointer 读取
      const review = await this._readPendingInterrupt(threadId);
      if (review) {
        yield { type: "interrupt", review };
        return;
      }

      if (!signal?.aborted) {
        yield {
          type: "error",
          code: classifyStreamError(err),
          message: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      if (!completed && eventStream && typeof eventStream.abort === "function") {
        try { await eventStream.abort(new Error("Client disconnected")); } catch {}
      }
    }
  }

  /** 从 checkpointer 读取 pending interrupt，不存在时返回 null。 */
  private async _readPendingInterrupt(threadId: string): Promise<ToolReviewInterrupt | null> {
    try {
      const config = { configurable: { thread_id: threadId } };
      const tuple = await this._checkpointer.getTuple(config);
      const channelValues = tuple?.checkpoint?.channel_values as Record<string, unknown> | undefined;
      if (channelValues && "__interrupt__" in channelValues) {
        const interrupts = channelValues.__interrupt__ as Array<{ value: unknown }>;
        if (interrupts.length > 0) {
          const value = interrupts[0].value;
          if (value && typeof value === "object" && (value as Record<string, unknown>).kind === "tool_review") {
            return value as ToolReviewInterrupt;
          }
        }
      }
    } catch { /* checkpointer read failed */ }
    return null;
  }

  async deleteThread(threadId: string): Promise<void> {
    await this._checkpointer.deleteThread(threadId);
  }
}

/** 将 streamEvents 抛出的底层异常映射为稳定错误码。 */
export function classifyStreamError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "STREAM_ERROR";
  }
  const msg = error.message.toLowerCase();
  // 网络不可达
  if (
    msg.includes("fetch") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("abort")
  ) {
    return "NETWORK_ERROR";
  }
  // 鉴权失败 (HTTP 401/403)
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication") ||
    msg.includes("invalid api key")
  ) {
    return "AUTH_ERROR";
  }
  // 限流 (HTTP 429)
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests")) {
    return "RATE_LIMITED";
  }
  // 模型协议异常 (schema mismatch, invalid response)
  if (
    msg.includes("schema") ||
    msg.includes("validation") ||
    msg.includes("parse") ||
    msg.includes("unexpected") ||
    msg.includes("invalid") ||
    msg.includes("did not match")
  ) {
    return "MODEL_ERROR";
  }
  // 工具执行异常
  if (msg.includes("tool") || msg.includes("handler")) {
    return "TOOL_ERROR";
  }
  return "STREAM_ERROR";
}
