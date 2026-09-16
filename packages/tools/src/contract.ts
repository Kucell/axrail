export type ToolRiskLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export type ToolEffect =
  | "read"
  | "local-write"
  | "engineering-write"
  | "deploy"
  | "physical-action"
  | "safety-critical";

export interface ToolExecutionContext {
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly actorId?: string;
  /**
   * Providers/adapters that are active for this execution scope. Resolution
   * must select exactly one provider for the requested semantic Tool.
   */
  readonly providerIds?: readonly string[];
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolInvocationDescription {
  readonly target?: string;
  readonly artifactRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ToolInvocationContextSnapshot {
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly actorId?: string;
  readonly environment?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Immutable evidence for one governed Tool invocation.
 *
 * The envelope is created after input validation. Policy, Approval, Audit and
 * execution consume the same normalized input and evidence digest so they
 * cannot silently reason about different versions of a Tool call.
 */
export interface ToolInvocationEnvelope<TInput = unknown> {
  readonly callId: string;
  readonly toolName: string;
  readonly toolDescription: string;
  readonly toolVersion?: string;
  readonly providerId?: string;
  readonly risk: ToolRiskLevel;
  readonly effect: ToolEffect;
  readonly input: TInput;
  readonly target?: string;
  readonly artifactRefs?: readonly string[];
  readonly descriptionMetadata?: Readonly<Record<string, unknown>>;
  readonly context: ToolInvocationContextSnapshot;
  readonly evidenceDigest: string;
}

export interface ToolResult<T = unknown> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Semantic Tool identity, for example `hmi.screen.create`. */
  readonly name: string;
  readonly version?: string;
  /** Concrete provider/adapter binding, separate from semantic identity. */
  readonly providerId?: string;
  readonly description: string;
  readonly risk: ToolRiskLevel;
  readonly effect: ToolEffect;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly timeoutMs?: number;
  readonly idempotent?: boolean;
  validateInput?(input: unknown): TInput;
  describeInvocation?(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolInvocationDescription | undefined> | ToolInvocationDescription | undefined;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput> | TOutput;
  validateResult?(result: TOutput): Promise<void> | void;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Optional explicit provider override for non-model callers. */
  readonly providerId?: string;
  readonly input: unknown;
}
