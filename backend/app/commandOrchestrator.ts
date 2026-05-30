import type { z } from "zod";
import type { LLMProvider } from "../domain/llmProvider";
import type { ChatMessage } from "../domain/llmProvider";
import type { ToolDescriptor, ToolRegistry } from "../domain/toolRegistry";
import type { ParseResult } from "../domain/commandTypes";
import type { SessionMessage } from "../domain/sessionTypes";
import {
  LLMCommandParser,
  type ParserContext,
  extractJson,
  describeSchemaForPrompt,
  buildSystemPrompt,
} from "../infrastructure/parser/llmCommandParser";

export type OrchestratorResult =
  | { kind: "chat"; message: string }
  | { kind: "finish"; message: string }
  | { kind: "clarification"; clarificationQuestion: string; missingFields?: string[] }
  | { kind: "unknown"; reason?: string }
  | { kind: "tool_call"; tool: string; arguments: unknown; confidence?: number }
  | { kind: "error"; message: string };

export class CommandOrchestrator {
  constructor(
    private readonly llm: LLMProvider,
    private readonly parser: LLMCommandParser,
    private readonly registry: ToolRegistry,
  ) {}

  async process(
    userText: string,
    context: ParserContext,
    history: readonly SessionMessage[] = [],
  ): Promise<OrchestratorResult> {
    const tools = this.registry.listDescriptors();
    const result = await this.parser.parse(userText, context, tools, history);

    if (result.kind === "finish") return result;
    if (result.kind !== "tool_call") return result;

    return this.validateAndFix(userText, result, context, history);
  }

  private async validateAndFix(
    userText: string,
    toolCall: { tool: string; arguments: Record<string, unknown>; confidence?: number },
    context: ParserContext,
    history: readonly SessionMessage[] = [],
    attempt = 0,
  ): Promise<OrchestratorResult> {
    const tool = this.registry.get(toolCall.tool);
    if (!tool) {
      return {
        kind: "error",
        message: "我没能正确理解这条日程指令，请换一种更明确的说法。",
      };
    }

    const parsed = tool.schema.safeParse(toolCall.arguments);
    if (parsed.success) {
      return {
        kind: "tool_call",
        tool: toolCall.tool,
        arguments: parsed.data,
        confidence: toolCall.confidence,
      };
    }

    if (attempt >= 1) {
      return {
        kind: "error",
        message: "我没能正确理解这条日程指令，请换一种更明确的说法。",
      };
    }

    const attribution = await this.errorAttribution(
      userText,
      toolCall,
      tool,
      parsed.error,
      context,
      history,
    );

    if (attribution.kind === "clarification") return attribution;

    return this.validateAndFix(
      userText,
      { tool: toolCall.tool, arguments: attribution.arguments, confidence: toolCall.confidence },
      context,
      history,
      attempt + 1,
    );
  }

  private async errorAttribution(
    userText: string,
    toolCall: { tool: string; arguments: Record<string, unknown> },
    tool: ToolDescriptor,
    zodError: z.ZodError,
    context: ParserContext,
    history: readonly SessionMessage[] = [],
  ): Promise<
    | { kind: "clarification"; clarificationQuestion: string; missingFields: string[] }
    | { kind: "tool_call"; arguments: Record<string, unknown> }
  > {
    const messages = buildAttributionMessages(
      userText,
      toolCall,
      tool,
      zodError,
      context,
      history,
    );

    try {
      const raw = await this.llm.chat(messages);
      const jsonText = extractJson(raw);
      const parsed = JSON.parse(jsonText);
      return validateAttributionResult(parsed);
    } catch {
      return {
        kind: "clarification",
        clarificationQuestion: "请再描述一下您的需求，我没有完全理解。",
        missingFields: [],
      };
    }
  }
}

function buildAttributionMessages(
  userText: string,
  toolCall: { tool: string; arguments: Record<string, unknown> },
  tool: ToolDescriptor,
  zodError: z.ZodError,
  context: ParserContext,
  history: readonly SessionMessage[] = [],
): ChatMessage[] {
  const systemContent = `You are a command validation assistant. A user's command was parsed but failed schema validation. Determine the root cause.

## Available Tool Schema
${tool.name}: ${describeSchemaForPrompt(tool.schema)}

## Context
- Current time: ${context.currentTime}
- Timezone: ${context.timezone}

## Task
Classify the error as ONE of:

**A. User information missing** — required fields are genuinely absent from the user's words (considering conversation history). The user did NOT say or imply the missing values. Do NOT guess or invent missing information.

**B. JSON generation error** — the information IS present in the user's input (or conversation history), but the JSON output was malformed (wrong type, wrong field name, format error, or a required field that the user clearly stated was omitted from the JSON). Fix the JSON using only information the user provided.

Output ONLY one JSON object — no markdown, no backticks, no explanation.

If A:
{"kind": "clarification", "clarificationQuestion": "<one clear question in the user's language asking for the missing info>", "missingFields": ["field1"]}

If B:
{"kind": "tool_call", "arguments": { ...corrected arguments using only user-provided info } }`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
  ];

  for (const msg of history) {
    if (msg.kind === "user") {
      messages.push({ role: "user", content: msg.text });
    } else if (msg.kind === "assistant") {
      let content = msg.content;
      if (msg.resultKind === "tool_call" && msg.tool) {
        content = `[Intent: execute ${msg.tool} with ${JSON.stringify(msg.arguments ?? {})}] ${content}`;
      }
      messages.push({ role: "assistant", content });
    } else if (msg.kind === "tool") {
      messages.push({
        role: "user",
        content: `[Tool Result: ${msg.toolName} — ${msg.success ? "success" : "failed"}]\n${msg.message}`,
      });
    }
  }

  messages.push({
    role: "user",
    content: `## Current User Input\n${userText}\n\n## Parsed Tool Call\nTool: ${toolCall.tool}\nArguments: ${JSON.stringify(toolCall.arguments, null, 2)}\n\n## Validation Error\n${zodError.message}`,
  });

  return messages;
}

function validateAttributionResult(
  parsed: unknown,
):
  | { kind: "clarification"; clarificationQuestion: string; missingFields: string[] }
  | { kind: "tool_call"; arguments: Record<string, unknown> } {
  if (!parsed || typeof parsed !== "object") {
    return {
      kind: "clarification",
      clarificationQuestion: "请再描述一下您的需求，我没有完全理解。",
      missingFields: [],
    };
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.kind === "tool_call") {
    return {
      kind: "tool_call",
      arguments:
        typeof obj.arguments === "object" && obj.arguments !== null
          ? (obj.arguments as Record<string, unknown>)
          : {},
    };
  }

  return {
    kind: "clarification",
    clarificationQuestion:
      typeof obj.clarificationQuestion === "string"
        ? obj.clarificationQuestion
        : "请再描述一下您的需求，我没有完全理解。",
    missingFields: Array.isArray(obj.missingFields)
      ? obj.missingFields.filter((f): f is string => typeof f === "string")
      : [],
  };
}
