import {
  ToolRegistry,
  type ToolDefinition,
} from "@axrail/tools";
import { mcpToolName } from "./naming.js";
import { createDefaultMcpRiskResolver } from "./risk.js";
import type {
  BridgedMcpTool,
  McpBridgeOptions,
  McpToolClassification,
  McpToolDescriptor,
} from "./types.js";
import { toMcpCallContext } from "./types.js";

export class McpToolBridge {
  private readonly options: McpBridgeOptions;
  private readonly registry: ToolRegistry;
  private readonly bridged = new Map<string, BridgedMcpTool>();

  constructor(registry: ToolRegistry, options: McpBridgeOptions) {
    this.registry = registry;
    this.options = options;
  }

  async sync(): Promise<readonly BridgedMcpTool[]> {
    const remoteTools = await this.options.client.listTools();
    const discovered = new Set(remoteTools.map((tool) => tool.name));

    for (const [remoteName, tool] of this.bridged) {
      if (!discovered.has(remoteName)) {
        tool.dispose();
        this.bridged.delete(remoteName);
      }
    }

    for (const descriptor of remoteTools) {
      if (this.bridged.has(descriptor.name)) continue;
      const bridged = this.registerDescriptor(descriptor);
      this.bridged.set(descriptor.name, bridged);
    }

    return [...this.bridged.values()];
  }

  list(): readonly BridgedMcpTool[] {
    return [...this.bridged.values()];
  }

  dispose(): void {
    for (const tool of this.bridged.values()) tool.dispose();
    this.bridged.clear();
  }

  private registerDescriptor(descriptor: McpToolDescriptor): BridgedMcpTool {
    if (!descriptor.name) throw new Error("MCP tool name must not be empty");

    const localName = mcpToolName(
      this.options.client.serverId,
      descriptor.name,
      this.options.namespace,
    );
    const classification = this.classify(descriptor);

    const definition: ToolDefinition<unknown, unknown> = {
      name: localName,
      description:
        descriptor.description ??
        descriptor.title ??
        `MCP tool ${descriptor.name} from ${this.options.client.serverId}`,
      risk: classification.risk,
      effect: classification.effect,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema,
      idempotent: classification.idempotent,
      timeoutMs: this.options.timeoutMs,
      execute: (input, context) =>
        this.options.client.callTool(
          descriptor.name,
          input,
          toMcpCallContext(context),
        ),
    };

    const unregister = this.registry.register(definition);
    return {
      remoteName: descriptor.name,
      localName,
      serverId: this.options.client.serverId,
      classification,
      descriptor,
      dispose: unregister,
    };
  }

  private classify(descriptor: McpToolDescriptor): McpToolClassification {
    const resolver =
      this.options.riskResolver ??
      createDefaultMcpRiskResolver({
        defaultRisk: this.options.defaultRisk,
        defaultEffect: this.options.defaultEffect,
      });

    return resolver({
      serverId: this.options.client.serverId,
      trustedServer: this.options.trustedServer ?? false,
      descriptor,
    });
  }
}
