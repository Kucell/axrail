import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolInvocationEnvelope,
  ToolResult,
} from "./contract.js";
import { createToolInvocationEnvelope } from "./invocation.js";
import { ToolRegistry, ToolResolutionError } from "./registry.js";

export interface ToolPolicyObligation {
  readonly type: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface ToolPolicyDecision {
  readonly allow: boolean;
  readonly code?: "policy_unavailable" | "policy_denied";
  readonly reason?: string;
  readonly requireApproval?: boolean;
  readonly obligations?: readonly ToolPolicyObligation[];
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
  readonly providerId?: string;
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
  readonly beforeExecute?: (
    invocation: ToolInvocationEnvelope,
  ) => Promise<void> | void;
  readonly now?: () => string;
  readonly onEvent?: (event: ToolRuntimeEvent) => Promise<void> | void;
}

export class ToolRuntime {
  readonly registry: ToolRegistry;
  private readonly policy?: ToolPolicyEvaluator;
  private readonly approval?: ToolApprovalProvider;
  private readonly beforeExecute?: ToolRuntimeOptions["beforeExecute"];
  private readonly now: () => string;
  private readonly onEvent?: ToolRuntimeOptions["onEvent"];

  constructor(options: ToolRuntimeOptions = {}) {
    this.registry = options.registry ?? new ToolRegistry();
    this.policy = options.policy;
    this.approval = options.approval;
    this.beforeExecute = options.beforeExecute;
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
      tool = this.registry.get(call.name, {
        providerId: call.providerId,
        providerIds: context.providerIds,
      });
    } catch (error) {
      const code = error instanceof ToolResolutionError ? error.code : "tool_not_found";
      const result = failure(code, messageOf(error));
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
      providerId: invocation.providerId,
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

    const highRiskApprovalRequired = invocation.risk === "L4" || invocation.risk === "L5";
    const approvalRequired = Boolean(decision.requireApproval) || highRiskApprovalRequired;

    await this.emit("tool.policy.evaluated", call, context, {
      allow: decision.allow,
      code: decision.code,
      requireApproval: approvalRequired,
      reason: decision.reason,
      obligations: decision.obligations,
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

    const obligationError = enforceToolObligations(invocation, decision.obligations);
    if (obligationError) {
      const result = failure("policy_obligation_unsatisfied", obligationError);
      await this.emit("tool.policy.obligation_failed", call, context, {
        message: obligationError,
        obligations: decision.obligations,
      }, invocation);
      await this.emit("tool.execution.failed", call, context, result.error, invocation);
      return result;
    }

    if (invocation.risk === "L5" && !invocation.context.transactionId) {
      const result = failure(
        "transaction_required",
        "L5 safety-critical Tool execution requires an explicit transaction boundary",
      );
      await this.emit("tool.execution.failed", call, context, result.error, invocation);
      return result;
    }

    if (approvalRequired) {
      await this.emit("tool.approval.requested", call, context, {
        risk: tool.risk,
        evidenceDigest: invocation.evidenceDigest,
        target: invocation.target,
        highRiskFloor: highRiskApprovalRequired,
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

    if (this.beforeExecute) {
      try {
        await this.beforeExecute(invocation);
      } catch (error) {
        const result = failure(
          "audit_unavailable",
          `Required pre-execution checkpoint failed: ${messageOf(error)}`,
        );
        await this.emit("tool.execution.failed", call, context, result.error, invocation);
        return result;
      }
    }

    await this.emit("tool.execution.started", call, context, {
      providerId: invocation.providerId,
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
        providerId: invocation.providerId,
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
        providerId: invocation?.providerId ?? call.providerId,
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
      // Ordinary lifecycle events are observational. Deployments that require
      // durable evidence use the authoritative beforeExecute checkpoint.
    }
  }
}

function enforceToolObligations(
  invocation: ToolInvocationEnvelope,
  obligations: readonly ToolPolicyObligation[] | undefined,
): string | undefined {
  for (const obligation of obligations ?? []) {
    switch (obligation.type) {
      case "require-transaction":
        if (!invocation.context.transactionId) {
          return "Policy obligation require-transaction is not satisfied";
        }
        break;
      case "require-environment": {
        const expected = obligation.parameters?.environment ?? obligation.parameters?.value;
        if (typeof expected !== "string" || invocation.context.environment !== expected) {
          return `Policy obligation require-environment is not satisfied (expected ${String(expected)})`;
        }
        break;
      }
      default:
        return `Unsupported policy obligation: ${obligation.type}`;
    }
  }
  return undefined;
}

function executionContext(
  invocation: ToolInvocationEnvelope,
  signal: AbortSignal | undefined,
): ToolExecutionContext {
  return {
    sessionId: invocation.context.sessionId,
    transactionId: invocation.context.transactionId,
    actorId: invocation.context.actorId,
    providerIds: invocation.providerId ? [invocation.providerId] : undefined,
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
