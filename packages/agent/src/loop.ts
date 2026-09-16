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
} from "./types.js";

export interface AgentLoopOptions {
  readonly model: AgentModelProvider;
  readonly tools: ToolRuntime;
  readonly systemPrompt?: string;
  readonly maxSteps?: number;
  readonly now?: () => string;
  readonly onEvent?: (event: AgentEvent) => Promise<void> | void;
}

export class AgentLoop {
  private readonly model: AgentModelProvider;
  private readonly tools: ToolRuntime;
  private readonly systemPrompt?: string;
  private readonly maxSteps: number;
  private readonly now: () => string;
  private readonly onEvent?: AgentLoopOptions["onEvent"];

  constructor(options: AgentLoopOptions) {
    this.model = options.model;
    this.tools = options.tools;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps ?? 16;
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
        tools: this.modelTools(),
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
      // simpler than parallel execution of arbitrary tool calls.
      for (const call of response.toolCalls) {
        const toolResult = await this.tools.execute(
          { id: call.id, name: call.name, input: call.input },
          this.toolContext(session.id, context),
        );
        session.append({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: serializeToolResult(toolResult),
        });
        await this.emit(session.id, "agent.tool.completed", step, {
          toolCallId: call.id,
          tool: call.name,
          ok: toolResult.ok,
          errorCode: toolResult.error?.code,
        });
      }
    }

    await this.emit(session.id, "agent.max_steps", this.maxSteps);
    return this.result("max_steps", session, this.maxSteps);
  }

  private modelTools(): readonly AgentModelTool[] {
    return this.tools.registry.list().map((tool) => ({
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
