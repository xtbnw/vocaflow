import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
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
import { sanitizeAssistantText } from "../../shared/assistantTextSanitizer";

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
/** 构造时生成 system prompt，嵌入当前日期与 Asia/Shanghai 时区。
 *
 *  限制：system prompt 在 DeepAgent 构造时固化。对于长期运行的服务器进程，
 *  prompt 中的日期可能偏离实际日期，重启进程即可刷新。
 *  相对时间解析准确性依赖 LLM 自身对日期上下文的理解，
 *  stream() 中额外注入的当前时间可提供参考。 */
export function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).format(now);

  return `你是一个日历语音助手。当前日期：${dateStr}，时区：Asia/Shanghai (UTC+8)。

你可以通过以下工具管理用户日程：
- query_events：查询指定时间范围内的已有日程。
- create_event：创建日程。调用后系统会自动展示最终审批面板。
- delete_event：删除日程。调用后系统会自动展示最终审批面板。

请使用中文回复，保持简洁清晰。只输出适合直接展示和语音播报的简单纯文本：
- 不要使用 Markdown，不要使用星号、井号、反引号、下划线或表格。
- 不要使用项目符号列表。需要列举时，使用简短的自然语言句子。
- 日期和时间使用适合朗读的口语表达。例如：“6月2日，也就是周二，上午的10点到11点有场前端开发面试，其余时间都没有安排。”
- 查询一周安排时，不要先复述完整的日期范围，不要输出“安排如下”。直接说明有日程的日期和空闲情况。

## 通用原则
1. 用户提供的信息可能不完整或模糊。允许通过多轮对话逐步澄清，不要猜测关键字段。
2. 当需要查询日历时，必须实际调用 query_events，不得只回复“我先查询一下”或假装已经查询。
3. 查询结果为空时，应明确说明该时间范围内没有已有安排。
4. 不要向用户暴露工具名称、参数格式、eventId 或内部执行细节。
5. 创建和删除操作最终都会由系统展示审批面板。调用写工具前不要额外询问“是否确认创建”或“是否确认删除”。

## 查询日程
当用户询问日程安排、空闲时间或某段时间是否有空时：
1. 将用户描述的时间范围转换为带时区的 ISO 8601 时间范围。
2. 调用 query_events 查询已有日程。
3. 根据实际查询结果回答用户。

如果用户希望安排日程，但只给出了模糊时间范围，例如“这周”“下周”“周三下午”“找个空闲时间”：
1. 先调用 query_events 查询相关时间范围内的已有日程。
2. 根据查询结果提出一个明确的候选时间段，例如“周三 14:00–15:00 可以吗？”。
3. 如果无法可靠判断合适时间，简要列出已有安排并请用户选择，不得擅自决定。

## 创建日程
调用 create_event 前，需要确认：
- 标题
- 精确开始时间
- 预计时长，或者精确结束时间

处理规则：
1. 缺少必要信息时，继续询问用户。
2. 用户只给出模糊时间范围时，先查询已有日程，再提出明确候选时间。
3. 用户只说“可以”“好的”“就这样”等简短回复时，结合当前 thread 中最近的候选方案继续处理。
4. 用户给出时长时，根据已确认的开始时间计算结束时间。
5. 仅当标题、精确开始时间和结束时间都足够明确时调用 create_event。
6. 不得因为用户表达了创建意图就立即调用 create_event。
7. 不得虚构已经创建成功。实际结果以工具返回为准。

## 删除日程
1. 如果用户明确提供了目标日程的 eventId，调用 delete_event。
2. 如果用户通过标题、日期或自然语言描述目标日程，先调用 query_events 查询。
3. 如果查询结果只有一个明确匹配项，调用 delete_event。
4. 如果存在多个可能匹配项，列出必要信息并询问用户选择。
5. 不得只回复“我先查询一下”而不实际调用 query_events。
6. 不得虚构已经删除成功。实际结果以工具返回为准。`;
}

/** 格式化当前本地时间，每次请求动态计算。 */
function formatCurrentDateTime(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

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
        // 不注册自定义 subagent。内置 subagent 与主 agent 共享同一工具集
        // （query_events、create_event、delete_event），不会获得额外宿主访问能力。
        createDeepAgent({
          model: llm,
          // createDeepAgent 的 tools 参数期望与 LangChain DynamicStructuredTool 精确匹配；
          // createQueryEventsTool 返回的 LangChain tool 实例与之兼容但类型推断受限。
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: tools as any,
          checkpointer: this._checkpointer,
          systemPrompt: buildSystemPrompt(),
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
    // 当前时间作为独立 SystemMessage 注入，不污染 HumanMessage 原始内容
    const dateContext = `当前本地时间：${formatCurrentDateTime()}，时区：Asia/Shanghai (UTC+8)`;
    yield* this._runStream(
      { messages: [new SystemMessage(dateContext), new HumanMessage(message)] },
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
    input: { messages: BaseMessage[] } | Command,
    threadId: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    if (signal?.aborted) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventStream: any = undefined;
    let toolCallsDrain: Promise<void> | undefined;
    let eventsChanged = false;
    let settled = false;

    try {
      eventStream = await this._agent.streamEvents(input, {
        configurable: { thread_id: threadId },
        version: "v3",
        ...(signal ? { signal } : {}),
      });
      toolCallsDrain = consumeToolCallOutputs(eventStream?.toolCalls);

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
                const text = sanitizeAssistantText(delta.text);
                if (text.length === 0) continue;
                yield { type: "message_delta", messageId: currentMessageId, text };
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

        // for-await 结束后等待 output Promise 终态，避免竞态导致未捕获的 interrupt
        if (!signal?.aborted) {
          yield* this._settleStreamOutput(eventStream, threadId, eventsChanged);
          settled = true;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    } catch (err) {
      // 捕获 streamEvents 初始化失败或 output rejection 中抛出的异常
      if (!signal?.aborted) {
        // 优先检查是否为 GraphInterrupt
        const interruptPayload = extractInterruptPayload(err);
        if (interruptPayload) {
          yield { type: "interrupt", review: interruptPayload };
          settled = true;
          return;
        }

        // 仅 GraphInterrupt 形态可能需要等待 checkpoint 延迟写入。
        // 普通网络、鉴权或模型异常直接分类，避免无意义的 500ms 尾延迟。
        if (hasInterruptShape(err)) {
          const review = await this._pollPendingInterrupt(threadId);
          if (review) {
            yield { type: "interrupt", review };
            settled = true;
            return;
          }
        }

        yield {
          type: "error",
          code: classifyStreamError(err),
          message: err instanceof Error ? err.message : String(err),
        };
        settled = true;
      }
    } finally {
      if (!settled && eventStream && typeof eventStream.abort === "function") {
        try { await eventStream.abort(new Error("Client disconnected")); } catch {}
      }
      await toolCallsDrain;
    }
  }

  /**
   * 等待 eventStream.output 终态，检查 interrupted 公开 API，
   * 必要时通过 checkpoint 轮询捕获延迟写入的 interrupt。
   * 优先使用公开 API，仅在公开 API 不足时回退到 bounded checkpoint 轮询。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async *_settleStreamOutput(
    eventStream: any,
    threadId: string,
    eventsChanged: boolean,
  ): AsyncIterable<AgentStreamEvent> {
    // 1) 等待 output Promise 终态（消费 rejection 避免 unhandledRejection）
    if (eventStream?.output && typeof eventStream.output.then === "function") {
      try {
        await eventStream.output;
      } catch (outputErr) {
        // output rejection 中可能携带 GraphInterrupt
        const payload = extractInterruptPayload(outputErr);
        if (payload) throw outputErr; // 重新抛出让外层 catch 处理
        // 非 interrupt 错误也抛出让外层分类
        throw outputErr;
      }
    }

    // 2) 公开 API 明确表示正常完成时直接返回，避免正常请求承担 fallback 延迟
    if (eventStream?.interrupted === false) {
      if (eventsChanged) {
        yield { type: "events_changed" };
      }
      yield { type: "done" };
      return;
    }

    // 3) 公开 API 表示中断时优先读取 payload
    if (eventStream?.interrupted === true) {
      const payload = extractInterruptsPayload(eventStream?.interrupts);
      if (payload) {
        yield { type: "interrupt", review: payload };
        return;
      }
    }

    // 4) 仅在旧实现缺少公开 interrupted 标志，或 payload 延迟可见时轮询 checkpoint
    const review = await this._pollPendingInterrupt(threadId);
    if (review) {
      yield { type: "interrupt", review };
      return;
    }

    // 5) 未知中断不得伪装为成功完成
    if (eventStream?.interrupted === true) {
      yield {
        type: "error",
        code: "STREAM_ERROR",
        message: "Agent interrupted without a supported review payload",
      };
      return;
    }

    // 6) 兼容缺少 interrupted 公开标志的旧实现
    if (eventsChanged) {
      yield { type: "events_changed" };
    }
    yield { type: "done" };
  }

  /** 有上限的 checkpoint 轮询：最多 10 次，每次 50ms，总计 500ms。 */
  private async _pollPendingInterrupt(threadId: string): Promise<ToolReviewInterrupt | null> {
    const review = await this._readPendingInterrupt(threadId);
    if (review) return review;

    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const r = await this._readPendingInterrupt(threadId);
      if (r) return r;
    }
    return null;
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

/** 从异常中提取 ToolReviewInterrupt payload，不满足时返回 null。 */
export function extractInterruptPayload(err: unknown): ToolReviewInterrupt | null {
  if (Array.isArray(err)) return extractInterruptsPayload(err);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyErr = err as any;

  // 优先通过 LangGraph isGraphInterrupt 判定
  if (isGraphInterrupt(err)) {
    const payload = extractInterruptsPayload(anyErr.interrupts);
    if (payload) return payload;
  }

  // duck-type fallback：某些环境下 interrupt 可能以普通 Error + interrupts 属性方式抛出
  if (anyErr) return extractInterruptsPayload(anyErr.interrupts);

  return null;
}

/** 从 LangGraph interrupts 数组中提取首个受支持的审批 payload。 */
function extractInterruptsPayload(interrupts: unknown): ToolReviewInterrupt | null {
  if (!Array.isArray(interrupts)) return null;

  for (const interrupt of interrupts) {
    const value = interrupt && typeof interrupt === "object"
      ? ((interrupt as { payload?: unknown }).payload ?? (interrupt as { value?: unknown }).value)
      : undefined;
    if (value && typeof value === "object" && (value as Record<string, unknown>).kind === "tool_review") {
      return value as ToolReviewInterrupt;
    }
  }

  return null;
}

/** 判断异常是否可能是尚未携带可读 payload 的 LangGraph interrupt。 */
function hasInterruptShape(err: unknown): boolean {
  if (Array.isArray(err)) return true;
  if (isGraphInterrupt(err)) return true;
  return Boolean(
    err &&
    typeof err === "object" &&
    Array.isArray((err as { interrupts?: unknown }).interrupts),
  );
}

/**
 * DeepAgent v3 为工具调用额外提供 `toolCalls` 投影。
 * interrupt 会让投影中的 `call.output` reject；即使业务只消费 protocol events，
 * 也必须挂接 rejection handler，避免 Node 将其报告为 unhandledRejection。
 */
async function consumeToolCallOutputs(toolCalls: unknown): Promise<void> {
  if (
    !toolCalls ||
    typeof toolCalls !== "object" ||
    !(Symbol.asyncIterator in toolCalls)
  ) {
    return;
  }

  try {
    for await (const call of toolCalls as AsyncIterable<{ output?: Promise<unknown> }>) {
      void call.output?.catch(() => undefined);
    }
  } catch {
    // protocol event stream owns application-visible error reporting
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
    msg.includes("etimedout") ||
    msg.includes("abort") ||
    msg.includes("connection error") ||
    msg.includes("socket hang up")
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
