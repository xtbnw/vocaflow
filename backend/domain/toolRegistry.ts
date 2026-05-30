import type { ZodSchema } from "zod";

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
