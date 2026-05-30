import type { ZodSchema } from "zod";
import {
  type CreateEventArgs,
  CreateEventArgsSchema,
  type QueryEventsArgs,
  QueryEventsArgsSchema,
  type FindEventsForDeleteArgs,
  FindEventsForDeleteArgsSchema,
} from "./calendarTypes";

export interface ToolDescriptor {
  readonly name: string;
  readonly schema: ZodSchema;
  readonly handler: (args: unknown) => Promise<unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ParsedCommandInput {
  tool: string;
  arguments: unknown;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();

  register(tool: ToolDescriptor): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  async execute(command: ParsedCommandInput): Promise<ToolResult> {
    const tool = this.tools.get(command.tool);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: "${command.tool}". Available tools: ${[...this.tools.keys()].join(", ")}`,
      };
    }

    const parsed = tool.schema.safeParse(command.arguments);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid arguments for tool "${command.tool}": ${parsed.error!.message}`,
      };
    }

    try {
      const data = await tool.handler(parsed.data);
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Tool execution failed",
      };
    }
  }
}

export const createEventHandler = async (args: unknown) => {
  const a = args as CreateEventArgs;
  return { tool: "create_event" as const, message: "placeholder: would create event", args: a };
};

export const queryEventsHandler = async (args: unknown) => {
  const a = args as QueryEventsArgs;
  return { tool: "query_events" as const, message: "placeholder: would query events", args: a };
};

export const findEventsForDeleteHandler = async (args: unknown) => {
  const a = args as FindEventsForDeleteArgs;
  return { tool: "find_events_for_delete" as const, message: "placeholder: would find candidates for delete", args: a };
};

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({ name: "create_event", schema: CreateEventArgsSchema, handler: createEventHandler });
  registry.register({ name: "query_events", schema: QueryEventsArgsSchema, handler: queryEventsHandler });
  registry.register({ name: "find_events_for_delete", schema: FindEventsForDeleteArgsSchema, handler: findEventsForDeleteHandler });
  return registry;
}
