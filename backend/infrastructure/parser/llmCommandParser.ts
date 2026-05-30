import type { ChatMessage, LLMProvider } from "../../domain/llmProvider";
import type { ToolDescriptor } from "../../domain/toolRegistry";
import type { ParseResult } from "../../domain/commandTypes";
import type { SessionMessage } from "../../domain/sessionTypes";
import type { CommandParser, ParserContext } from "../../app/ports/commandParser";

export type { ParserContext };

export class LLMCommandParser implements CommandParser {
  constructor(private readonly llm: LLMProvider) {}

  async parse(
    currentText: string,
    context: ParserContext,
    tools: readonly ToolDescriptor[],
    history: readonly SessionMessage[] = [],
  ): Promise<ParseResult> {
    const messages = buildMessages(currentText, context, tools, history);

    try {
      const raw = await this.llm.chat(messages);
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

const SYSTEM_INSTRUCTIONS = `You are a command parser for a voice calendar assistant with multi-step reasoning capability. Analyze the user's input in the context of the full conversation history — including previous tool execution results — and output exactly one JSON object.

## Available Tools
{{TOOLS}}

## Context
- Current time: {{CURRENT_TIME}}
- Timezone: {{TIMEZONE}}

## Multi-Step Reasoning (ReAct)
You may chain multiple tool calls to complete a complex request. After a tool executes, its result appears in the conversation as a [Tool Result] message. Analyze the result and decide the next action:

1. If the result contains data needed for a follow-up action, call the next appropriate tool with arguments derived from those results.
2. **CRITICAL — Deletion flow**: When the user wants to delete events (e.g., "删除今天的全部日程", "删除明天的会议"), you MUST follow this two-step pattern:
   a. FIRST call query_events with the time range / keyword extracted from the user's words.
   b. THEN call delete_event with the eventIds from the query result.
   c. NEVER ask the user for event IDs — users don't know internal IDs. Always query first yourself.
   d. If query_events returns no events, output "finish" saying no matching events were found.
3. When the user's request is fully satisfied, output "finish" with a natural summary message in the user's language.
4. Do NOT repeat a tool call that was just executed with identical arguments — this would cause an infinite loop.
5. After receiving a [Tool Result], review it and determine the next appropriate action to complete the user's original request.

## Task
Classify the user's input into one of five kinds. Consider ALL conversation history — user messages, assistant intent markers, AND tool execution results — when interpreting the current message. Output ONLY the JSON — no markdown, no backticks, no explanations.

## Kinds

### tool_call
The user wants to execute a calendar tool. All required arguments must be extractable from the user's words combined with conversation history (including tool results). If any required field is still missing, use "clarification" instead — EXCEPT for delete_event: never ask clarification about eventIds; query first instead.

IMPORTANT — title field: use exactly what the user said about the event. Generic words like "开会", "见面", "聚餐", "讨论", "碰一下", "聊一聊" ARE valid titles — do NOT ask for a more specific topic. The user's own phrasing is the title.

{
  "kind": "tool_call",
  "tool": "<tool name>",
  "arguments": { ...tool-specific fields },
  "confidence": 0.0-1.0
}

### finish
The user's request has been fully completed. Use this to summarize the outcome after all necessary tool calls have been made. The message should be a natural, conversational summary in the user's language describing what was done.
{
  "kind": "finish",
  "message": "<summary of what was accomplished>"
}

### clarification
A required field is missing or the intent is ambiguous. Ask ONE specific question in the user's language. Do NOT ask the user to elaborate a title that is already sufficient — "开会" is a complete title; "明天开会" needs only time resolution, not a topic question.
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
Cannot understand the intent at all, even with conversation history.
{
  "kind": "unknown",
  "reason": "<brief reason>"
}`;

export function buildMessages(
  currentText: string,
  context: ParserContext,
  tools: readonly ToolDescriptor[],
  history: readonly SessionMessage[] = [],
): ChatMessage[] {
  const toolDescriptions = tools
    .map((t) => `- ${t.name}: ${describeSchemaForPrompt(t.schema)}`)
    .join("\n");

  const systemContent = SYSTEM_INSTRUCTIONS
    .replace("{{TOOLS}}", toolDescriptions || "- (none)")
    .replace("{{CURRENT_TIME}}", context.currentTime)
    .replace("{{TIMEZONE}}", context.timezone);

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
        content: `[Tool Result: ${msg.toolName} — ${msg.success ? "success" : "failed"}]\n${msg.message}\nData: ${JSON.stringify(msg.data ?? null)}`,
      });
    }
  }

  if (currentText.trim()) {
    messages.push({ role: "user", content: currentText });
  }

  return messages;
}

export function buildSystemPrompt(
  context: ParserContext,
  tools: readonly ToolDescriptor[],
): string {
  const toolDescriptions = tools
    .map((t) => `- ${t.name}: ${describeSchemaForPrompt(t.schema)}`)
    .join("\n");

  return SYSTEM_INSTRUCTIONS
    .replace("{{TOOLS}}", toolDescriptions || "- (none)")
    .replace("{{CURRENT_TIME}}", context.currentTime)
    .replace("{{TIMEZONE}}", context.timezone);
}

export function describeSchemaForPrompt(schema: unknown): string {
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
  const fenceJson = /```(?:json)?\s*\n?([\s\S]*?)```/;
  const match = text.match(fenceJson);
  if (match) return match[1].trim();

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

const VALID_KINDS = new Set(["tool_call", "clarification", "chat", "unknown", "finish"]);

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

    case "finish":
      return {
        kind: "finish",
        message: typeof obj.message === "string" ? obj.message : "任务已完成",
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
