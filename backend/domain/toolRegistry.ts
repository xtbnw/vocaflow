import type { ZodSchema } from "zod";
import {
  type CalendarEvent,
  CalendarEventSchema,
  type CreateEventArgs,
  CreateEventArgsSchema,
  type FindEventsForDeleteArgs,
  FindEventsForDeleteArgsSchema,
  type QueryEventsArgs,
  QueryEventsArgsSchema,
} from "./calendarTypes";
import type { CalendarRepository } from "./calendarRepository";

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

  listDescriptors(): readonly ToolDescriptor[] {
    return [...this.tools.values()];
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

// -- Real handlers (client-side, with CalendarRepository) --

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultEndAt(startAt: string): string {
  return new Date(new Date(startAt).getTime() + 3_600_000).toISOString();
}

export const createEventHandler = (repo: CalendarRepository) =>
  async (args: unknown) => {
    const a = args as CreateEventArgs;
    const now = new Date().toISOString();
    const event: CalendarEvent = CalendarEventSchema.parse({
      id: newId(),
      title: a.title,
      startAt: a.startAt,
      endAt: a.endAt ?? defaultEndAt(a.startAt),
      location: a.location,
      notes: a.notes,
      reminderMinutesBefore: a.reminderMinutesBefore,
      source: "text",
      createdAt: now,
      updatedAt: now,
    });
    const saved = await repo.save(event);
    return { action: "created", event: saved };
  };

export const queryEventsHandler = (repo: CalendarRepository) =>
  async (args: unknown) => {
    const a = args as QueryEventsArgs;
    const all = await repo.list();
    let filtered = all.filter(
      (e) => e.startAt >= a.rangeStartAt && e.startAt < a.rangeEndAt,
    );
    if (a.keyword) {
      const kw = a.keyword.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(kw) ||
          (e.notes && e.notes.toLowerCase().includes(kw)),
      );
    }
    filtered.sort((x, y) => x.startAt.localeCompare(y.startAt));
    return { action: "queried", events: filtered };
  };

export const findEventsForDeleteHandler = (repo: CalendarRepository) =>
  async (args: unknown) => {
    const a = args as FindEventsForDeleteArgs;
    const all = await repo.list();
    let filtered = all;
    if (a.rangeStartAt && a.rangeEndAt) {
      filtered = filtered.filter(
        (e) =>
          e.startAt >= a.rangeStartAt! && e.startAt < a.rangeEndAt!,
      );
    }
    if (a.keyword) {
      const kw = a.keyword.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(kw) ||
          (e.notes && e.notes.toLowerCase().includes(kw)),
      );
    }
    return { action: "found_candidates", events: filtered };
  };

// -- Placeholder handlers (server-side) --

const placeholderHandler =
  (tool: string) => async (args: unknown) => {
    return { tool, message: `placeholder: would execute ${tool}`, args };
  };

// -- Factory --

export function createDefaultToolRegistry(repo?: CalendarRepository): ToolRegistry {
  const registry = new ToolRegistry();

  if (repo) {
    registry.register({ name: "create_event", schema: CreateEventArgsSchema, handler: createEventHandler(repo) });
    registry.register({ name: "query_events", schema: QueryEventsArgsSchema, handler: queryEventsHandler(repo) });
    registry.register({ name: "find_events_for_delete", schema: FindEventsForDeleteArgsSchema, handler: findEventsForDeleteHandler(repo) });
  } else {
    registry.register({ name: "create_event", schema: CreateEventArgsSchema, handler: placeholderHandler("create_event") });
    registry.register({ name: "query_events", schema: QueryEventsArgsSchema, handler: placeholderHandler("query_events") });
    registry.register({ name: "find_events_for_delete", schema: FindEventsForDeleteArgsSchema, handler: placeholderHandler("find_events_for_delete") });
  }

  return registry;
}
