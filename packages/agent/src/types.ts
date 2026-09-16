import type { ToolEffect, ToolRiskLevel } from "@axrail/tools";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentToolCall {
  readonly id: string;
  readonly name: string;
  /** Optional explicit provider for deterministic/custom model providers. */
  readonly providerId?: string;
  readonly input: unknown;
}

export interface AgentMessage {
  readonly role: AgentMessageRole;
  readonly content?: string;
  readonly toolCalls?: readonly AgentToolCall[];
  readonly toolCallId?: string;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentModelTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly risk: ToolRiskLevel;
  readonly effect: ToolEffect;
}

export interface AgentModelRequest {
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentModelTool[];
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentModelResponse {
  readonly content?: string;
  readonly toolCalls?: readonly AgentToolCall[];
  readonly stopReason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentModelProvider {
  readonly id: string;
  complete(request: AgentModelRequest): Promise<AgentModelResponse>;
}

export interface AgentRunContext {
  readonly actorId?: string;
  readonly transactionId?: string;
  /** Active Adapter/Tool providers for semantic Tool resolution. */
  readonly providerIds?: readonly string[];
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentEvent {
  readonly type: string;
  readonly sessionId: string;
  readonly time: string;
  readonly step?: number;
  readonly data?: unknown;
}

export type AgentRunStatus = "completed" | "max_steps" | "cancelled";

export interface AgentRunResult {
  readonly status: AgentRunStatus;
  readonly sessionId: string;
  readonly content?: string;
  readonly steps: number;
  readonly messages: readonly AgentMessage[];
}
