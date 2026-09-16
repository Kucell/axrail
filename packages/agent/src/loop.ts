import {
  ToolRuntime,
  type ToolExecutionContext,
  type ToolResult,
} from "@axrail/tools";
import { AgentSession } from "./session.js";
import type {
  AgentEvent,
  AgentMessage,
  AgentModelProvider,
  AgentModelTool,
  AgentRunContext,
  AgentRunResult,
  AgentToolCall,
} from "./types.js";

export type AgentToolFailureMode = "stop" | "continue";

export interface AgentLoopOptions {
  readonly model: AgentModelProvider;
  readonly tools: ToolRuntime;
  readonly systemPrompt?: string;
  readonly maxSteps?: number;
  /**
   * Controls whether later Tool calls from the same model turn execute after
   * an earlier Tool failure. Defaults to `stop` for safer industrial behavior.
   */
  readonly toolFailureMode?: AgentToolFailureMode;
  readonly now?: () => string;
  readonly onEvent?: (event: AgentEvent) => Promise<void> | void;
}

export class AgentLoop {
  private readonly model: AgentModelProvider;
  private readonly tools: ToolRuntime;
  private readonly systemPrompt?: string;
  private readonly maxSteps: number;
  private readonly toolFailureMode: AgentToolFailureMode;
  private readonly now: () => string;
  private readonly onEvent?: AgentLoopOptions["onEvent"];

  constructor(options: AgentLoopOptions) {
    this.model = options.model;
    this.tools = options.tools;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps ?? 16;
    this.toolFailureMode = options.toolFailureMode ?? "stop";
    if (this.maxSteps < 1) throw new Error("Agent maxSteps must be at least 1");
    this.now = options.now ?? (() => new Date().toISOString());
    this.onEvent = options.onEvent;
  }

  async run(
    input: string,
    context: AgentRunContext = {},
    session: AgentSession = new AgentSession(),
  ): Promise<AgentRunResult> {
    if (session.size === 0 && this.systemPrompt) {
      session.append({ role: "system", content: this.systemPrompt });
    }
    session.append({ role: "user", content: input });

    for (let step = 1; step <= this.maxSteps; step += 1) {
      if (context.signal?.aborted) {
        await this.emit(session.id, "agent.cancelled", step);
        return this.result("cancelled", session, step - 1);
      }

      await this.emit(session.id, "agent.step.started", step);
      const response = await this.model.complete({
        messages: session.messages(),
        tools: this.modelTools(context),
        signal: context.signal,
        metadata: context.metadata,
      });

      const assistantMessage: AgentMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        metadata: response.metadata,
      };
      session.append(assistantMessage);
      await this.emit(session.id, "agent.model.completed", step, {
        stopReason: response.stopReason,
        toolCallCount: response.toolCalls?.length ?? 0,
      });

      if (!response.toolCalls?.length) {
        await this.emit(session.id, "agent.completed", step);
        return this.result("completed", session, step, response.content);
      }

      // Industrial side effects are deliberately sequential by default. This
      // preserves deterministic ordering and makes audit/rollback reasoning
      // simpler than parallel execution of arbitrary Tool calls.
      for (let index = 0; index < response.toolCalls.length; index += 1) {
        const call = response.toolCalls[index];
        const toolResult = await this.tools.execute(
          {
            id: call.id,
            name: call.name,
            providerId: call.providerId,
            input: call.input,
          },
          this.toolContext(session.id, context),
        );
        this.appendToolResult(session, call, toolResult);
        await this.emit(session.id, "agent.tool.completed", step, {
          toolCallId: call.id,
          tool: call.name,
          providerId: call.providerId,
          ok: toolResult.ok,
          errorCode: toolResult.error?.code,
        });

        if (!toolResult.ok && this.toolFailureMode === "stop") {
          const remaining = response.toolCalls.slice(index + 1);
          for (const skipped of remaining) {
            const skippedResult = skippedAfterFailure(call, skipped);
            this.appendToolResult(session, skipped, skippedResult);
            await this.emit(session.id, "agent.tool.skipped", step, {
              toolCallId: skipped.id,
              tool: skipped.name,
              providerId: skipped.providerId,
              reason: "skipped_after_tool_failure",
              failedToolCallId: call.id,
            });
          }
          await this.emit(session.id, "agent.tool_batch.stopped", step, {
            failedToolCallId: call.id,
            skippedToolCallCount: remaining.length,
          });
          break;
        }
      }
    }

    await this.emit(session.id, "agent.max_steps", this.maxSteps);
    return this.result("max_steps", session, this.maxSteps);
  }

  private appendToolResult(
    session: AgentSession,
    call: AgentToolCall,
    result: ToolResult,
  ): void {
    session.append({
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: serializeToolResult(result),
    });
  }

  private modelTools(context: AgentRunContext): readonly AgentModelTool[] {
    return this.tools.registry.list({ providerIds: context.providerIds }).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      risk: tool.risk,
      effect: tool.effect,
    }));
  }

  private toolContext(sessionId: string, context: AgentRunContext): ToolExecutionContext {
    return {
      sessionId,
      transactionId: context.transactionId,
      actorId: context.actorId,
      providerIds: context.providerIds,
      signal: context.signal,
      metadata: context.metadata,
    };
  }

  private result(
    status: AgentRunResult["status"],
    session: AgentSession,
    steps: number,
    content?: string,
  ): AgentRunResult {
    return {
      status,
      sessionId: session.id,
      content,
      steps,
      messages: session.messages(),
    };
  }

  private emit(sessionId: string, type: string, step?: number, data?: unknown): Promise<void> {
    return Promise.resolve(
      this.onEvent?.({ type, sessionId, time: this.now(), step, data }),
    );
  }
}

function skippedAfterFailure(
  failed: AgentToolCall,
  skipped: AgentToolCall,
): ToolResult {
  return {
    ok: false,
    error: {
      code: "skipped_after_tool_failure",
      message: `Tool ${skipped.name} was not executed because ${failed.name} (${failed.id}) failed earlier in the same model turn`,
    },
  };
}

function serializeToolResult(result: ToolResult): string {
  try {
    return JSON.stringify(result);
  } catch {
    return JSON.stringify({
      ok: false,
      error: {
        code: "tool_result_serialization_failed",
        message: "Tool result could not be serialized",
      },
    });
  }
}
