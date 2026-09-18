import {
  AgentLoop,
  AgentSession,
  type AgentEvent,
  type AgentModelProvider,
  type AgentRunContext,
  type AgentRunResult,
} from "@axrail/agent";
import type { EventPrincipalRef } from "@axrail/events";
import type { HarnessRuntime } from "./runtime.js";

export interface HarnessAgentOptions {
  readonly model: AgentModelProvider;
  readonly systemPrompt?: string;
  readonly maxSteps?: number;
  /**
   * Optional observational Agent event callback.
   *
   * Harness persists the authoritative Session event first. Callback failures
   * are isolated so UI/instrumentation observers cannot rewrite execution
   * truth after an authoritative event has been recorded.
   */
  readonly onEvent?: (event: AgentEvent) => Promise<void> | void;
}

export interface HarnessAgentRunOptions extends AgentRunContext {
  readonly sessionId?: string;
}

export class HarnessAgent {
  constructor(
    private readonly harness: HarnessRuntime,
    private readonly options: HarnessAgentOptions,
  ) {}

  async run(
    input: string,
    options: HarnessAgentRunOptions = {},
  ): Promise<AgentRunResult> {
    const session = await this.harness.sessions.create({
      id: options.sessionId,
      actor: principalFromActorId(options.actorId),
      metadata: options.metadata,
      correlationId: metadataString(options.metadata, "correlationId"),
    });

    const loop = new AgentLoop({
      model: this.options.model,
      tools: this.harness.tools,
      systemPrompt: this.options.systemPrompt,
      maxSteps: this.options.maxSteps,
      eventFailureMode: "propagate",
      now: () => this.harness.currentTime(),
      onEvent: async (event) => {
        // Harness Session events are replayable application state, not optional
        // telemetry. AgentLoop therefore propagates failures for this binding.
        await this.harness.sessions.append(session.id, {
          type: event.type,
          source: "agent",
          correlationId: metadataString(options.metadata, "correlationId"),
          data: {
            step: event.step,
            event: event.data,
          },
        });
        try {
          await this.options.onEvent?.(event);
        } catch {
          // Observational consumers (for example Interaction SDK/UI bridges)
          // must not change authoritative Agent/Tool execution truth.
        }
      },
    });

    try {
      const result = await loop.run(
        input,
        {
          actorId: options.actorId,
          transactionId: options.transactionId,
          providerIds: options.providerIds,
          signal: options.signal,
          metadata: {
            ...options.metadata,
            environment:
              metadataString(options.metadata, "environment") ??
              this.harness.environment,
          },
        },
        new AgentSession(session.id),
      );

      if (result.status === "cancelled") {
        await this.harness.sessions.cancel(session.id, {
          agentStatus: result.status,
          steps: result.steps,
        });
      } else {
        await this.harness.sessions.complete(session.id, {
          agentStatus: result.status,
          steps: result.steps,
        });
      }

      return result;
    } catch (error) {
      await this.harness.sessions.fail(session.id, {
        code: "agent_run_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function principalFromActorId(actorId: string | undefined): EventPrincipalRef | undefined {
  return actorId ? { id: actorId, type: "human" } : undefined;
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}
