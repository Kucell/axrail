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
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
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
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRiskLevel;
  readonly effect: ToolEffect;
  readonly timeoutMs?: number;
  readonly idempotent?: boolean;
  validateInput?(input: unknown): TInput;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput> | TOutput;
  validateResult?(result: TOutput): Promise<void> | void;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
