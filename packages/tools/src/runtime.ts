import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./contract.js";
import { ToolRegistry } from "./registry.js";

export interface ToolPolicyDecision {
  readonly allow: boolean;
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

export interface ToolRuntimeOptions {
  readonly registry?: ToolRegistry;
  readonly policy?: ToolPolicyEvaluator;
  readonly approval?: ToolApprovalProvider;
}

export class ToolRuntime {
  readonly registry: ToolRegistry;
  private readonly policy?: ToolPolicyEvaluator;
  private readonly approval?: ToolApprovalProvider;

  constructor(options: ToolRuntimeOptions = {}) {
    this.registry = options.registry ?? new ToolRegistry();
    this.policy = options.policy;
    this.approval = options.approval;
  }

  async execute(
    call: ToolCall,
    context: ToolExecutionContext = {},
  ): Promise<ToolResult> {
    let tool: ToolDefinition<unknown, unknown>;
    try {
      tool = this.registry.get(call.name);
    } catch (error) {
      return failure("tool_not_found", messageOf(error));
    }

    let input: unknown = call.input;
    try {
      input = tool.validateInput ? tool.validateInput(call.input) : call.input;
    } catch (error) {
      return failure("invalid_input", messageOf(error));
    }

    if (context.signal?.aborted) {
      return failure("cancelled", "Tool execution was cancelled before start");
    }

    if (this.policy) {
      const decision = await this.policy.evaluate(tool, call, context);
      if (!decision.allow) {
        return failure("policy_denied", decision.reason ?? "Tool execution denied by policy");
      }
      if (decision.requireApproval) {
        if (!this.approval) {
          return failure("approval_unavailable", "Approval is required but no approval provider is configured");
        }
        const approved = await this.approval.approve(tool, call, context);
        if (!approved) return failure("approval_denied", "Tool execution was not approved");
      }
    }

    try {
      const execution = Promise.resolve(tool.execute(input, context));
      const value = tool.timeoutMs
        ? await withTimeout(execution, tool.timeoutMs)
        : await execution;
      if (tool.validateResult) await tool.validateResult(value);
      return { ok: true, value };
    } catch (error) {
      return failure("execution_failed", messageOf(error));
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
