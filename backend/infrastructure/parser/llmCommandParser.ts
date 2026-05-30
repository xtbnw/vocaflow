import type { LLMProvider } from "../../domain/llmProvider";
import type { ToolDescriptor } from "../../domain/toolRegistry";
import type { ParseResult } from "../../domain/commandTypes";

export interface ParserContext {
  currentTime: string;
  timezone: string;
}

export class LLMCommandParser {
  constructor(private readonly llm: LLMProvider) {}

  async parse(
    userText: string,
    context: ParserContext,
    tools: readonly ToolDescriptor[],
  ): Promise<ParseResult> {
    const prompt = buildPrompt(userText, context, tools);

    try {
      const raw = await this.llm.chat(prompt);
      const jsonText = extractJson(raw);
      const parsed = JSON.parse(jsonText);
      return validateResult(parsed);
    } catch (err) {
      return {
        kind: "unknown",
        reason: `Failed to parse LLM response: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

export function buildPrompt(
  userText: string,
  context: ParserContext,
  tools: readonly ToolDescriptor[],
): string {
  const toolDescriptions = tools
    .map((t) => `- ${t.name}: ${describeSchemaForPrompt(t.schema)}`)
    .join("\n");

  return `You are a command parser. Analyze user input and output exactly one JSON object.

## Available Tools
${toolDescriptions || "- (none)"}

## Context
- Current time: ${context.currentTime}
- Timezone: ${context.timezone}

## Task
Classify the user's input into one of four kinds. Output ONLY the JSON — no markdown, no backticks, no explanations.

## Kinds

### tool_call
The user wants to execute a tool. All required arguments must be extractable from the user's words. If any required field is missing, use "clarification" instead. Do NOT invent dates/times/names the user did not provide.
{
  "kind": "tool_call",
  "tool": "<tool name>",
  "arguments": { ...tool-specific fields },
  "confidence": 0.0-1.0
}

### clarification
A required field is missing or the intent is ambiguous. Ask ONE specific question.
{
  "kind": "clarification",
  "clarificationQuestion": "<one clear question in the user's language>",
  "missingFields": ["field1"]
}

### chat
Conversational message unrelated to calendar tools — greeting, chit-chat, general question.
{
  "kind": "chat",
  "message": "<natural reply in the user's language>"
}

### unknown
Cannot understand the intent at all.
{
  "kind": "unknown",
  "reason": "<brief reason>"
}

## User Input
${userText}`;
}

function describeSchemaForPrompt(schema: unknown): string {
  try {
    const zodSchema = schema as { shape?: Record<string, unknown> };
    if (!zodSchema.shape) return "{}";

    const fields: string[] = [];
    for (const [key, field] of Object.entries(zodSchema.shape)) {
      const def = (field as { _def?: { typeName?: string; innerType?: unknown } })._def;
      const isOptional = def?.typeName === "ZodOptional";
      const inner = isOptional ? (def?.innerType as { _def?: { typeName?: string } })?._def : def;
      const typeName = inner?.typeName ?? "unknown";
      const typeStr = zodTypeLabel(typeName);
      fields.push(`  "${key}": ${typeStr}${isOptional ? " (optional)" : ""}`);
    }
    return `{\n${fields.join(",\n")}\n}`;
  } catch {
    return "{}";
  }
}

function zodTypeLabel(typeName: string): string {
  if (typeName.includes("String") || typeName.includes("DateTime") || typeName.includes("Iso")) return "string";
  if (typeName.includes("Number")) return "number";
  if (typeName.includes("Boolean")) return "boolean";
  if (typeName.includes("Enum")) return "string";
  return "string";
}

export function extractJson(text: string): string {
  // strip markdown code fences if present
  const fenceJson = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const match = text.match(fenceJson);
  if (match) return match[1].trim();

  // find the first { ... } pair
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return text;
  let depth = 0;
  for (let i = firstBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) return text.slice(firstBrace, i + 1);
  }
  return text;
}

const VALID_KINDS = new Set(["tool_call", "clarification", "chat", "unknown"]);

export function validateResult(parsed: unknown): ParseResult {
  if (!parsed || typeof parsed !== "object") {
    return { kind: "unknown", reason: "Response is not an object" };
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.kind !== "string" || !VALID_KINDS.has(obj.kind)) {
    return { kind: "unknown", reason: `Invalid kind: ${String(obj.kind)}` };
  }

  switch (obj.kind) {
    case "tool_call":
      return {
        kind: "tool_call",
        tool: typeof obj.tool === "string" ? obj.tool : "",
        arguments:
          typeof obj.arguments === "object" && obj.arguments !== null
            ? (obj.arguments as Record<string, unknown>)
            : {},
        confidence:
          typeof obj.confidence === "number" ? obj.confidence : undefined,
      };

    case "clarification":
      return {
        kind: "clarification",
        clarificationQuestion:
          typeof obj.clarificationQuestion === "string"
            ? obj.clarificationQuestion
            : "Could you clarify?",
        missingFields: Array.isArray(obj.missingFields)
          ? obj.missingFields.filter((f): f is string => typeof f === "string")
          : undefined,
      };

    case "chat":
      return {
        kind: "chat",
        message:
          typeof obj.message === "string" ? obj.message : "",
      };

    case "unknown":
      return {
        kind: "unknown",
        reason: typeof obj.reason === "string" ? obj.reason : undefined,
      };

    default:
      return { kind: "unknown", reason: `Unexpected kind: ${String(obj.kind)}` };
  }
}
