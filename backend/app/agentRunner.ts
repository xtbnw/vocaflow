import type { OrchestratorResult } from "./commandOrchestrator";
import {
  makeAssistantMessage,
  makeToolMessage,
} from "./sessionManager";
import type { ToolExecutor } from "./toolExecutor";
import type { PendingAction } from "./types/pendingAction";
import type {
  SessionMessage,
  UserMessage,
} from "../domain/sessionTypes";
import type { ParserContext } from "../infrastructure/parser/llmCommandParser";

export interface AgentDecisionProvider {
  process(
    text: string,
    context: ParserContext,
    history?: readonly SessionMessage[],
  ): Promise<OrchestratorResult>;
}

export interface AgentRunResult {
  messages: SessionMessage[];
  pendingAction?: PendingAction;
  eventsChanged: boolean;
}

const WRITE_TOOLS = new Set(["create_event", "delete_event"]);

export class AgentRunner {
  constructor(
    private readonly orchestrator: AgentDecisionProvider,
    private readonly executor: ToolExecutor,
    private readonly maxIterations = 20,
  ) {}

  async runUserMessage(
    userMessage: UserMessage,
    context: ParserContext,
    history: readonly SessionMessage[] = [],
  ): Promise<AgentRunResult> {
    return this.continueLoop(context, [...history, userMessage]);
  }

  async confirmPendingAction(
    pendingActionId: string,
    context: ParserContext,
    history: readonly SessionMessage[],
  ): Promise<AgentRunResult> {
    const pending = this.executor.getPendingAction(pendingActionId);
    if (!pending) {
      return this.withError(history, "未找到待确认的操作");
    }

    const result = await this.executor.executePendingAction(pendingActionId);
    if (result.kind !== "execution") {
      return this.withError(history, "确认执行失败");
    }

    const messages = [
      ...history,
      makeToolMessage(
        pending.type,
        pending.payload as Record<string, unknown>,
        result.success,
        result.message,
        result.data,
      ),
    ];

    if (!result.success) {
      return { messages, eventsChanged: false };
    }

    return this.continueLoop(context, messages, true);
  }

  cancelPendingAction(
    pendingActionId: string,
    history: readonly SessionMessage[],
  ): AgentRunResult {
    const pending = this.executor.getPendingAction(pendingActionId);
    if (!pending || !this.executor.cancelPendingAction(pendingActionId)) {
      return this.withError(history, "未找到待确认的操作");
    }

    return {
      messages: [
        ...history,
        makeToolMessage(
          pending.type,
          pending.payload as Record<string, unknown>,
          false,
          "操作已取消",
        ),
      ],
      eventsChanged: false,
    };
  }

  private async continueLoop(
    context: ParserContext,
    history: readonly SessionMessage[],
    eventsChanged = false,
  ): Promise<AgentRunResult> {
    let messages = [...history];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const decision = await this.orchestrator.process("", context, messages);

      if (decision.kind !== "tool_call") {
        return {
          messages: [...messages, toAssistantMessage(decision)],
          eventsChanged,
        };
      }

      messages.push(
        makeAssistantMessage(
          `正在执行${toolLabel(decision.tool)}…`,
          "tool_call",
          decision.tool,
          decision.arguments as Record<string, unknown>,
        ),
      );

      const result = await this.executor.execute(
        decision.tool,
        decision.arguments,
      );

      if (result.kind === "pending_action") {
        this.executor.storePendingAction(result.pendingAction);
        messages.push(
          makeToolMessage(
            decision.tool,
            decision.arguments as Record<string, unknown>,
            true,
            result.message,
          ),
        );
        return {
          messages,
          pendingAction: result.pendingAction,
          eventsChanged,
        };
      }

      messages.push(
        makeToolMessage(
          decision.tool,
          decision.arguments as Record<string, unknown>,
          result.success,
          result.message,
          result.data,
        ),
      );

      if (!result.success) {
        return { messages, eventsChanged };
      }

      eventsChanged ||= WRITE_TOOLS.has(decision.tool);
    }

    return this.withError(messages, "执行步骤过多，请换一种更明确的说法。");
  }

  private withError(
    history: readonly SessionMessage[],
    message: string,
  ): AgentRunResult {
    return {
      messages: [...history, makeAssistantMessage(message, "unknown")],
      eventsChanged: false,
    };
  }
}

function toAssistantMessage(
  decision: Exclude<OrchestratorResult, { kind: "tool_call" }>,
) {
  switch (decision.kind) {
    case "chat":
    case "finish":
      return makeAssistantMessage(decision.message, decision.kind);
    case "clarification":
      return makeAssistantMessage(
        decision.clarificationQuestion,
        "clarification",
      );
    case "unknown":
      return makeAssistantMessage(decision.reason ?? "未能理解您的意图", "unknown");
    case "error":
      return makeAssistantMessage(decision.message, "unknown");
  }
}

function toolLabel(tool: string): string {
  switch (tool) {
    case "create_event":
      return "创建日程";
    case "query_events":
      return "查询日程";
    case "delete_event":
      return "删除日程";
    default:
      return tool;
  }
}
