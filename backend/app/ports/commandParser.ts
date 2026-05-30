import type { ToolDescriptor } from "../../domain/toolRegistry";
import type { ParseResult } from "../../domain/commandTypes";
import type { SessionMessage } from "../../domain/sessionTypes";

export interface ParserContext {
  currentTime: string;
  timezone: string;
}

export interface CommandParser {
  parse(
    currentText: string,
    context: ParserContext,
    tools: readonly ToolDescriptor[],
    history: readonly SessionMessage[],
  ): Promise<ParseResult>;
}
