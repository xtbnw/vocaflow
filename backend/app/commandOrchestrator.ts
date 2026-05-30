import type { z } from "zod";
import type { LLMProvider } from "../domain/llmProvider";
import type { ToolDescriptor, ToolRegistry } from "../domain/toolRegistry";
import type { ParseResult } from "../domain/commandTypes";
import {
  LLMCommandParser,
  type ParserContext,
  extractJson,
  describeSchemaForPrompt,
} from "../infrastructure/parser/llmCommandParser";

export type OrchestratorResult =
  | { kind: "chat"; message: string }
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
  ): Promise<OrchestratorResult> {
    const tools = this.registry.listDescriptors();
    const result = await this.parser.parse(userText, context, tools);

    if (result.kind !== "tool_call") return result;

    return this.validateAndFix(userText, result);
  }

  private async validateAndFix(
    userText: string,
    toolCall: { tool: string; arguments: Record<string, unknown>; confidence?: number },
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
    );

    if (attribution.kind === "clarification") return attribution;

    return this.validateAndFix(
      userText,
      { tool: toolCall.tool, arguments: attribution.arguments, confidence: toolCall.confidence },
      attempt + 1,
    );
  }

  private async errorAttribution(
    userText: string,
    toolCall: { tool: string; arguments: Record<string, unknown> },
    tool: ToolDescriptor,
    zodError: z.ZodError,
  ): Promise<
    | { kind: "clarification"; clarificationQuestion: string; missingFields: string[] }
    | { kind: "tool_call"; arguments: Record<string, unknown> }
  > {
    const prompt = buildAttributionPrompt(
      userText,
      toolCall,
      tool,
      zodError,
    );

    try {
      const raw = await this.llm.chat(prompt);
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

function buildAttributionPrompt(
  userText: string,
  toolCall: { tool: string; arguments: Record<string, unknown> },
  tool: ToolDescriptor,
  zodError: z.ZodError,
): string {
  return `You are a command validation assistant. A user's command was parsed but failed schema validation. Determine the root cause.

## User Input
${userText}

## Parsed Tool Call
Tool: ${toolCall.tool}
Arguments: ${JSON.stringify(toolCall.arguments, null, 2)}

## Expected Schema
${describeSchemaForPrompt(tool.schema)}

## Validation Error
${zodError.message}

## Task
Classify the error as ONE of:

**A. User information missing** — required fields are genuinely absent from the user's words. The user did NOT say or imply the missing values. Do NOT guess or invent missing information.

**B. JSON generation error** — the information IS present in the user's input, but the JSON output was malformed (wrong type, wrong field name, format error, or a required field that the user clearly stated was omitted from the JSON). Fix the JSON using only information the user provided.

Output ONLY one JSON object — no markdown, no backticks, no explanation.

If A:
{"kind": "clarification", "clarificationQuestion": "<one clear question in the user's language asking for the missing info>", "missingFields": ["field1"]}

If B:
{"kind": "tool_call", "arguments": { ...corrected arguments using only user-provided info } }`;
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
