import type { ChatMessage, LLMProvider } from "../../domain/llmProvider";
import type { ToolDescriptor } from "../../domain/toolRegistry";
import type { ParseResult } from "../../domain/commandTypes";
import type { SessionMessage } from "../../domain/sessionTypes";
import type { CommandParser, ParserContext } from "../../app/ports/commandParser";
import { extractJson, describeSchemaForPrompt } from "../../app/parserUtils";

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
        kind: "message",
        content: "我暂时无法处理这条指令，请换一种说法再试一次。",
      };
    }
  }
}

const SYSTEM_INSTRUCTIONS = `You are a voice calendar assistant with tool-calling capability.

Analyze the full conversation history, including tool results.
Choose the next best action autonomously:

1. Call a tool when calendar data must be queried or changed.
2. Reply to the user with a natural-language message when:
   - you need more information,
   - the request is complete,
   - the user is chatting,
   - the request cannot be completed,
   - or no tool call is needed.

Output exactly one JSON object — no markdown, no backticks, no explanations.

Tool call:
{
  "kind": "tool_call",
  "tool": "<tool name>",
  "arguments": { ... }
}

Natural-language reply:
{
  "kind": "message",
  "content": "<reply in the user's language>"
}

## Available Tools
{{TOOLS}}

## Context
- Current time: {{CURRENT_TIME}}
- Timezone: {{TIMEZONE}}

## Multi-Step Reasoning
You may chain multiple tool calls to complete a complex request. After a tool executes, its result appears in the conversation as a [Tool Result] message. Analyze the result and decide the next action.

IMPORTANT — title field: use exactly what the user said about the event. Generic words like "开会", "见面", "聚餐", "讨论", "碰一下", "聊一聊" ARE valid titles — do NOT ask for a more specific topic. The user's own phrasing is the title.

For deletion requests:
1. First call query_events using the user's time range or keywords.
2. After receiving the query result, call delete_event with eventIds from the tool result.
3. Never ask the user for internal event IDs.
4. If no event matches, reply naturally that no matching event was found.

Do not repeat the same tool call with identical arguments immediately after it was executed.`;

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
      if (msg.toolCall) {
        content = `[Intent: execute ${msg.toolCall.tool} with ${JSON.stringify(msg.toolCall.arguments)}] ${content}`;
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

const VALID_KINDS = new Set(["tool_call", "message"]);

export function validateResult(parsed: unknown): ParseResult {
  if (!parsed || typeof parsed !== "object") {
    return { kind: "message", content: "我暂时无法处理这条指令，请换一种说法再试一次。" };
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.kind !== "string" || !VALID_KINDS.has(obj.kind)) {
    return { kind: "message", content: "我暂时无法处理这条指令，请换一种说法再试一次。" };
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

    case "message":
      return {
        kind: "message",
        content: typeof obj.content === "string" ? obj.content : "",
      };

    default:
      return { kind: "message", content: "我暂时无法处理这条指令，请换一种说法再试一次。" };
  }
}
