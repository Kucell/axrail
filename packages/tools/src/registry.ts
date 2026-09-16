import type { ToolDefinition } from "./contract.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): () => void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as ToolDefinition<unknown, unknown>);
    return () => this.tools.delete(tool.name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get<TInput = unknown, TOutput = unknown>(name: string): ToolDefinition<TInput, TOutput> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool as ToolDefinition<TInput, TOutput>;
  }

  list(): readonly ToolDefinition<unknown, unknown>[] {
    return [...this.tools.values()];
  }
}
