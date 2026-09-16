import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./contract.js";
import { ToolRegistry } from "./registry.js";

export interface ToolPolicyDecision {
  readonly allow: boolean;
  readonly code?: "policy_unavailable" | "policy_denied";
  readonly reason?: string;
  readonly requireApproval?: boolean;
}

export interface ToolPolicyEvaluator {
  evaluate(
    tool: ToolDefinition<unknown, unknown>,
    call: ToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolPolicyDecision> | ToolPolicyDecision;
}

export interface ToolApprovalProvider {
  approve(
    tool: ToolDefinition<unknown, unknown>,
    call: ToolCall,
    context: ToolExecutionContext,
  ): Promise<boolean> | boolean;
}

export interface ToolRuntimeEvent {
  readonly type: string;
  readonly time: string;
  readonly callId: string;
  readonly toolName: string;
  readonly sessionId?: string;
  readonly transactionId?: string;
  readonly actorId?: string;
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

    let input: unknown = call.input;
    try {
      input = tool.validateInput ? tool.validateInput(call.input) : call.input;
    } catch (error) {
      const result = failure("invalid_input", messageOf(error));
      await this.emit("tool.execution.failed", call, context, result.error);
      return result;
    }

    if (context.signal?.aborted) {
      const result = failure("cancelled", "Tool execution was cancelled before start");
      await this.emit("tool.execution.cancelled", call, context, result.error);
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
      });
      await this.emit("tool.execution.failed", call, context, result.error);
      return result;
    }

    const decision: ToolPolicyDecision = this.policy
      ? await this.policy.evaluate(tool, call, context)
      : { allow: true };

    await this.emit("tool.policy.evaluated", call, context, {
      allow: decision.allow,
      code: decision.code,
      requireApproval: decision.requireApproval ?? false,
      reason: decision.reason,
      risk: tool.risk,
    });

    if (!decision.allow) {
      const result = failure(
        decision.code ?? "policy_denied",
        decision.reason ?? "Tool execution denied by policy",
      );
      await this.emit("tool.execution.failed", call, context, result.error);
      return result;
    }

    if (decision.requireApproval) {
      await this.emit("tool.approval.requested", call, context, { risk: tool.risk });
      if (!this.approval) {
        const result = failure(
          "approval_unavailable",
          "Approval is required but no approval provider is configured",
        );
        await this.emit("tool.approval.completed", call, context, {
          approved: false,
          code: result.error?.code,
        });
        await this.emit("tool.execution.failed", call, context, result.error);
        return result;
      }
      const approved = await this.approval.approve(tool, call, context);
      await this.emit("tool.approval.completed", call, context, { approved });
      if (!approved) {
        const result = failure("approval_denied", "Tool execution was not approved");
        await this.emit("tool.execution.failed", call, context, result.error);
        return result;
      }
    }

    await this.emit("tool.execution.started", call, context, {
      risk: tool.risk,
      effect: tool.effect,
    });

    try {
      const execution = Promise.resolve(tool.execute(input, context));
      const value = tool.timeoutMs
        ? await withTimeout(execution, tool.timeoutMs)
        : await execution;
      if (tool.validateResult) await tool.validateResult(value);
      const result: ToolResult = { ok: true, value };
      await this.emit("tool.execution.succeeded", call, context, {
        risk: tool.risk,
        effect: tool.effect,
      });
      return result;
    } catch (error) {
      const result = failure("execution_failed", messageOf(error));
      await this.emit("tool.execution.failed", call, context, result.error);
      return result;
    }
  }

  private async emit(
    type: string,
    call: ToolCall,
    context: ToolExecutionContext,
    data?: unknown,
  ): Promise<void> {
    if (!this.onEvent) return;
    try {
      await this.onEvent({
        type,
        time: this.now(),
        callId: call.id,
        toolName: call.name,
        sessionId: context.sessionId,
        transactionId: context.transactionId,
        actorId: context.actorId,
        data,
      });
    } catch {
      // Runtime instrumentation is observational in v0.1. Durable audit modes
      // can impose fail-closed persistence at the Harness/commit boundary.
    }
  }
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
