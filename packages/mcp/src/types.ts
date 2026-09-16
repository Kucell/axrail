import type { ToolEffect, ToolExecutionContext, ToolRiskLevel } from "@axrail/tools";

export interface McpToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

export interface McpToolDescriptor {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly annotations?: McpToolAnnotations;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface McpCallContext {
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly actorId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface McpClient {
  readonly serverId: string;
  listTools(): Promise<readonly McpToolDescriptor[]>;
  callTool(name: string, input: unknown, context?: McpCallContext): Promise<unknown>;
}

export interface McpToolClassification {
  readonly risk: ToolRiskLevel;
  readonly effect: ToolEffect;
  readonly idempotent?: boolean;
  readonly reason?: string;
}

export interface McpRiskContext {
  readonly serverId: string;
  readonly trustedServer: boolean;
  readonly descriptor: McpToolDescriptor;
}

export type McpRiskResolver = (
  context: McpRiskContext,
) => McpToolClassification;

export interface McpBridgeOptions {
  readonly client: McpClient;
  readonly trustedServer?: boolean;
  readonly namespace?: string;
  readonly defaultRisk?: ToolRiskLevel;
  readonly defaultEffect?: ToolEffect;
  readonly riskResolver?: McpRiskResolver;
  readonly timeoutMs?: number;
}

export interface BridgedMcpTool {
  readonly remoteName: string;
  readonly localName: string;
  readonly serverId: string;
  readonly classification: McpToolClassification;
  readonly descriptor: McpToolDescriptor;
  dispose(): void;
}

export function toMcpCallContext(context: ToolExecutionContext): McpCallContext {
  return {
    signal: context.signal,
    sessionId: context.sessionId,
    transactionId: context.transactionId,
    actorId: context.actorId,
    metadata: context.metadata,
  };
}
