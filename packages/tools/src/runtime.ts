import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationEnvelope,
  ToolResult,
} from "./contract.js";
import { createToolInvocationEnvelope } from "./invocation.js";
import { ToolRegistry } from "./registry.js";

export interface ToolPolicyDecision {
  readonly allow: boolean;
  readonly code?: "policy_unavailable" | "policy_denied";
  readonly reason?: string;
  readonly requireApproval?: boolean;
}

export interface ToolPolicyEvaluator {
  evaluate(
    invocation: ToolInvocationEnvelope,
  ): Promise<ToolPolicyDecision> | ToolPolicyDecision;
}

export interface ToolApprovalProvider {
  approve(invocation: ToolInvocationEnvelope): Promise<boolean> | boolean;
}

export interface ToolRuntimeEvent {
  readonly type: string;
  readonly time: string;
  readonly callId: string;
  readonly toolName: string;
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly correlationId?: string;
  readonly actorId?: string;
  readonly evidenceDigest?: string;
  readonly target?: string;
  readonly artifactRefs?: readonly string[];
  readonly data?: unknown;
}

export interface ToolRuntimeOptions {
  readonly registry?: ToolRegistry;
  readonly policy?: ToolPolicyEvaluator;
  readonly approval?: ToolApprovalProvider;
  readonly now?: () => string;
  readonly onEvent?: (event: ToolRuntimeEvent) => Promise<void> | void;
}

export class ToolRuntime {
  readonly registry: ToolRegistry;
  private readonly policy?: ToolPolicyEvaluator;
  private readonly approval?: ToolApprovalProvider;
  private readonly now: () => string;
  private readonly onEvent?: ToolRuntimeOptions["onEvent"];

  constructor(options: ToolRuntimeOptions = {}) {
    this.registry = options.registry ?? new ToolRegistry();
    this.policy = options.policy;
    this.approval = options.approval;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onEvent = options.onEvent;
  }

  async execute(
    call: ToolCall,
    context: ToolExecutionContext = {},
  ): Promise<ToolResult> {
    await this.emit("tool.execution.requested", call, context);

    let tool: ToolDefinition<unknown, unknown>;
    try {
      tool = this.registry.get(call.name);
    } catch (error) {
      const result = failure("tool_not_found", messageOf(error));
      await this.emit("tool.execution.failed", call, context, result.error);
      return result;
    }

    let invocation: ToolInvocationEnvelope;
    try {
      const effectiveInput = tool.validateInput ? tool.validateInput(call.input) : call.input;
      invocation = await createToolInvocationEnvelope(tool, call, effectiveInput, context);
    } catch (error) {
      const result = failure("invalid_input", messageOf(error));
      await this.emit("tool.execution.failed", call, context, result.error);
      return result;
    }

    await this.emit("tool.invocation.prepared", call, context, {
      risk: invocation.risk,
      effect: invocation.effect,
      evidenceDigest: invocation.evidenceDigest,
      target: invocation.target,
      artifactRefs: invocation.artifactRefs,
    }, invocation);

    if (context.signal?.aborted) {
      const result = failure("cancelled", "Tool execution was cancelled before start");
      await this.emit("tool.execution.cancelled", call, context, result.error, invocation);
      return result;
    }

    if (!this.policy && tool.risk !== "L0" && tool.risk !== "L1") {
      const result = failure(
        "policy_unavailable",
        `No policy provider configured for privileged tool ${tool.name} (${tool.risk})`,
      );
      await this.emit("tool.policy.evaluated", call, context, {
        allow: false,
        code: result.error?.code,
        risk: tool.risk,
        evidenceDigest: invocation.evidenceDigest,
      }, invocation);
      await this.emit("tool.execution.failed", call, context, result.error, invocation);
      return result;
    }

    const decision: ToolPolicyDecision = this.policy
      ? await this.policy.evaluate(invocation)
      : { allow: true };

    await this.emit("tool.policy.evaluated", call, context, {
      allow: decision.allow,
      code: decision.code,
      requireApproval: decision.requireApproval ?? false,
      reason: decision.reason,
      risk: tool.risk,
      evidenceDigest: invocation.evidenceDigest,
    }, invocation);

    if (!decision.allow) {
      const result = failure(
        decision.code ?? "policy_denied",
        decision.reason ?? "Tool execution denied by policy",
      );
      await this.emit("tool.execution.failed", call, context, result.error, invocation);
      return result;
    }

    if (decision.requireApproval) {
      await this.emit("tool.approval.requested", call, context, {
        risk: tool.risk,
        evidenceDigest: invocation.evidenceDigest,
        target: invocation.target,
      }, invocation);
      if (!this.approval) {
        const result = failure(
          "approval_unavailable",
          "Approval is required but no approval provider is configured",
        );
        await this.emit("tool.approval.completed", call, context, {
          approved: false,
          code: result.error?.code,
          evidenceDigest: invocation.evidenceDigest,
        }, invocation);
        await this.emit("tool.execution.failed", call, context, result.error, invocation);
        return result;
      }
      const approved = await this.approval.approve(invocation);
      await this.emit("tool.approval.completed", call, context, {
        approved,
        evidenceDigest: invocation.evidenceDigest,
      }, invocation);
      if (!approved) {
        const result = failure("approval_denied", "Tool execution was not approved");
        await this.emit("tool.execution.failed", call, context, result.error, invocation);
        return result;
      }
    }

    await this.emit("tool.execution.started", call, context, {
      risk: tool.risk,
      effect: tool.effect,
      evidenceDigest: invocation.evidenceDigest,
    }, invocation);

    try {
      const execution = Promise.resolve(
        tool.execute(invocation.input, executionContext(invocation, context.signal)),
      );
      const value = tool.timeoutMs
        ? await withTimeout(execution, tool.timeoutMs)
        : await execution;
      if (tool.validateResult) await tool.validateResult(value);
      const result: ToolResult = { ok: true, value };
      await this.emit("tool.execution.succeeded", call, context, {
        risk: tool.risk,
        effect: tool.effect,
        evidenceDigest: invocation.evidenceDigest,
      }, invocation);
      return result;
    } catch (error) {
      const result = failure("execution_failed", messageOf(error));
      await this.emit("tool.execution.failed", call, context, result.error, invocation);
      return result;
    }
  }

  private async emit(
    type: string,
    call: ToolCall,
    context: ToolExecutionContext,
    data?: unknown,
    invocation?: ToolInvocationEnvelope,
  ): Promise<void> {
    if (!this.onEvent) return;
    try {
      await this.onEvent({
        type,
        time: this.now(),
        callId: call.id,
        toolName: call.name,
        sessionId: invocation?.context.sessionId ?? context.sessionId,
        transactionId: invocation?.context.transactionId ?? context.transactionId,
        correlationId:
          metadataString(invocation?.context.metadata, "correlationId") ??
          metadataString(context.metadata, "correlationId"),
        actorId: invocation?.context.actorId ?? context.actorId,
        evidenceDigest: invocation?.evidenceDigest,
        target: invocation?.target,
        artifactRefs: invocation?.artifactRefs,
        data,
      });
    } catch {
      // Runtime instrumentation is observational in v0.1. Durable audit modes
      // can impose fail-closed persistence at the Harness/commit boundary.
    }
  }
}

function executionContext(
  invocation: ToolInvocationEnvelope,
  signal: AbortSignal | undefined,
): ToolExecutionContext {
  return {
    sessionId: invocation.context.sessionId,
    transactionId: invocation.context.transactionId,
    actorId: invocation.context.actorId,
    signal,
    metadata: invocation.context.metadata,
  };
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
