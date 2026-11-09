import { z } from 'zod';
import { ToolClass } from '../store.js';
import { ToolSpec } from '../providers/types.js';
import { WorkspaceGuard } from '../workspace.js';
import { ReadTracker } from '../read-tracker.js';

export interface ToolContext {
  sessionId: string;
  workspace: WorkspaceGuard;
  readTracker: ReadTracker;
  signal?: AbortSignal;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  class: ToolClass;
  description: string;
  schema: z.ZodType<TInput>;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

/**
 * Converts a Zod schema into a JSON Schema object for tool parameters.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const full = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema, ...rest } = full;
  return rest;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getSpecs(filter?: (t: ToolDefinition) => boolean): ToolSpec[] {
    const list = filter ? this.list().filter(filter) : this.list();
    return list.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema),
    }));
  }

  public async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const validatedInput = tool.schema.parse(input);
    return await tool.execute(validatedInput, context);
  }
}
