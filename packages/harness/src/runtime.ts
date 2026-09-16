import {
  AdapterHost,
  type AdapterHostOptions,
  type AxrailAdapter,
  type MountedAdapter,
  type AdapterLifecycleContext,
} from "@axrail/adapter-sdk";
import {
  ApprovalService,
  type ApprovalPrincipal,
  type ApprovalRequirement,
  isApprovalGranted,
} from "@axrail/approval";
import {
  InMemoryEventStore,
  SessionService,
  type EventPrincipalRef,
  type EventStore,
} from "@axrail/events";
import type { PolicyInput } from "@axrail/policy";
import {
  ToolRuntime,
  type ToolApprovalProvider,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolPolicyDecision,
  type ToolPolicyEvaluator,
  type ToolRuntimeEvent,
} from "@axrail/tools";
import {
  TransactionRuntime,
  createTransactionApprovalProvider,
  createTransactionPolicyEvaluator,
  type TransactionEvent,
  type TransactionExecutor,
  type TransactionRecord,
  type TransactionRuntimeOptions,
} from "@axrail/transactions";
import { HarnessAgent, type HarnessAgentOptions } from "./agent.js";

export interface HarnessRuntimeOptions {
  readonly adapterHost?: AdapterHost;
  readonly adapterHostOptions?: AdapterHostOptions;
  readonly eventStore?: EventStore;
  readonly approval?: ApprovalService;
  readonly environment?: string;
  readonly now?: () => string;
  readonly idFactory?: (prefix: string) => string;
}

export interface HarnessTransactionRuntimeOptions {
  readonly executor: TransactionExecutor;
  readonly allowWithoutPolicy?: boolean;
  readonly requiredApprovers?: readonly ApprovalRequirement[];
  readonly onEvent?: TransactionRuntimeOptions["onEvent"];
}

export class HarnessRuntime {
  readonly adapters: AdapterHost;
  readonly events: EventStore;
  readonly sessions: SessionService;
  readonly tools: ToolRuntime;
  readonly approval?: ApprovalService;
  readonly environment?: string;

  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(options: HarnessRuntimeOptions = {}) {
    this.adapters = options.adapterHost ?? new AdapterHost(options.adapterHostOptions);
    this.events = options.eventStore ?? new InMemoryEventStore();
    this.approval = options.approval;
    this.environment = options.environment;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.sessions = new SessionService({
      store: this.events,
      now: this.now,
      idFactory: () => this.idFactory("ses"),
      eventIdFactory: () => this.idFactory("evt"),
    });

    this.tools = new ToolRuntime({
      registry: this.adapters.tools,
      policy: new HarnessToolPolicy(this),
      approval: this.approval ? new HarnessToolApproval(this) : undefined,
      now: this.now,
      onEvent: (event) => this.recordToolEvent(event),
    });
  }

  createAgent(options: HarnessAgentOptions): HarnessAgent {
    return new HarnessAgent(this, options);
  }

  createTransactionRuntime(
    options: HarnessTransactionRuntimeOptions,
  ): TransactionRuntime {
    const policy = this.adapters.policy.list().length > 0
      ? createTransactionPolicyEvaluator(this.adapters.policy)
      : undefined;

    const approval = this.approval
      ? createTransactionApprovalProvider(this.approval, {
          requiredApprovers: options.requiredApprovers,
          requestId: () => this.nextId("approval"),
        })
      : undefined;

    return new TransactionRuntime({
      executor: options.executor,
      artifacts: this.adapters.artifacts,
      policy,
      approval,
      allowWithoutPolicy: options.allowWithoutPolicy,
      idFactory: () => this.nextId("tx"),
      now: this.now,
      validate: (changeSet, transaction) =>
        this.adapters.validation.validate(changeSet, {
          environment: transaction.context.environment ?? this.environment,
          signal: transaction.context.signal,
          metadata: {
            transactionId: transaction.id,
            mode: transaction.mode,
            sessionId: transaction.context.sessionId,
            correlationId: transaction.context.correlationId,
          },
        }),
      onEvent: async (event, transaction) => {
        await this.recordTransactionEvent(event, transaction);
        try {
          await options.onEvent?.(event, transaction);
        } catch {
          // Observer instrumentation is non-authoritative in v0.1.
        }
      },
    });
  }

  mountAdapter(
    adapter: AxrailAdapter,
    context: AdapterLifecycleContext = {},
  ): Promise<MountedAdapter> {
    return this.adapters.mount(adapter, {
      environment: context.environment ?? this.environment,
      metadata: context.metadata,
    });
  }

  unmountAdapter(
    adapterId: string,
    context: AdapterLifecycleContext = {},
  ): Promise<void> {
    return this.adapters.unmount(adapterId, {
      environment: context.environment ?? this.environment,
      metadata: context.metadata,
    });
  }

  toolPolicyInput(
    tool: ToolDefinition<unknown, unknown>,
    context: ToolExecutionContext,
  ): PolicyInput {
    return {
      action: tool.name,
      actor: context.actorId ? { id: context.actorId, type: "user" } : undefined,
      risk: tool.risk,
      environment: metadataString(context.metadata, "environment") ?? this.environment,
      capability: tool.name,
      facts: {
        effect: tool.effect,
        sessionId: context.sessionId,
        transactionId: context.transactionId,
      },
    };
  }

  toolApprovalPrincipal(context: ToolExecutionContext): ApprovalPrincipal | undefined {
    return context.actorId
      ? { id: context.actorId, type: "human" }
      : undefined;
  }

  nextId(prefix: string): string {
    return this.idFactory(prefix);
  }

  currentTime(): string {
    return this.now();
  }

  private async recordToolEvent(event: ToolRuntimeEvent): Promise<void> {
    try {
      await this.events.append({
        id: this.nextId("evt"),
        type: normalizedToolEventType(event),
        version: "1",
        time: event.time,
        sessionId: event.sessionId,
        transactionId: event.transactionId,
        toolCallId: event.callId,
        actor: principalFromActorId(event.actorId),
        source: "tool-runtime",
        correlationId: event.correlationId,
        data: {
          toolName: event.toolName,
          detail: event.data,
        },
      });
    } catch {
      // Event instrumentation remains observational until durable-audit mode is
      // explicitly enabled by a future Harness profile.
    }
  }

  private async recordTransactionEvent(
    event: TransactionEvent,
    transaction: TransactionRecord,
  ): Promise<void> {
    try {
      await this.events.append({
        id: this.nextId("evt"),
        type: event.type,
        version: "1",
        time: event.time,
        sessionId: event.sessionId,
        transactionId: event.transactionId,
        changeSetId: event.changeSetId ?? transaction.changeSet.id,
        artifactRefs:
          event.artifactRefs ?? transaction.changeSet.artifacts.map((artifact) => artifact.id),
        actor: principalFromTransaction(transaction),
        source: "transaction-runtime",
        correlationId: event.correlationId,
        data: {
          state: event.state,
          mode: transaction.mode,
          detail: event.data,
        },
      });
    } catch {
      // See recordToolEvent. Durable fail-closed auditing belongs to an explicit
      // deployment profile rather than changing transaction semantics silently.
    }
  }
}

class HarnessToolPolicy implements ToolPolicyEvaluator {
  constructor(private readonly harness: HarnessRuntime) {}

  async evaluate(
    tool: ToolDefinition<unknown, unknown>,
    _call: { readonly id: string; readonly name: string; readonly input: unknown },
    context: ToolExecutionContext,
  ): Promise<ToolPolicyDecision> {
    const providers = this.harness.adapters.policy.list();

    if (providers.length === 0) {
      if (tool.risk === "L0" || tool.risk === "L1") return { allow: true };
      return {
        allow: false,
        code: "policy_unavailable",
        reason: `No policy provider is registered for privileged tool ${tool.name} (${tool.risk})`,
      };
    }

    const decision = await this.harness.adapters.policy.evaluate(
      this.harness.toolPolicyInput(tool, context),
    );

    if (decision.effect === "deny") {
      return {
        allow: false,
        code: "policy_denied",
        reason: decision.reason,
      };
    }

    return {
      allow: true,
      requireApproval: decision.effect === "require-approval",
      reason: decision.reason,
    };
  }
}

class HarnessToolApproval implements ToolApprovalProvider {
  constructor(private readonly harness: HarnessRuntime) {}

  async approve(
    tool: ToolDefinition<unknown, unknown>,
    call: { readonly id: string; readonly name: string; readonly input: unknown },
    context: ToolExecutionContext,
  ): Promise<boolean> {
    if (!this.harness.approval) return false;

    const request = {
      id: this.harness.nextId("approval"),
      transactionId: context.transactionId,
      toolCallId: call.id,
      actor: this.harness.toolApprovalPrincipal(context),
      operation: {
        action: tool.name,
        description: tool.description,
        metadata: { effect: tool.effect },
      },
      risk: tool.risk,
      reason: `Policy requires approval for ${tool.name}`,
      metadata: {
        sessionId: context.sessionId,
        environment: metadataString(context.metadata, "environment") ?? this.harness.environment,
      },
    } as const;

    const decision = await this.harness.approval.request(request);
    return isApprovalGranted(request, decision, this.harness.currentTime());
  }
}

function normalizedToolEventType(event: ToolRuntimeEvent): string {
  if (event.type === "tool.policy.evaluated") return "policy.evaluation.completed";
  if (event.type === "tool.approval.requested") return "approval.requested";
  if (event.type === "tool.approval.completed") {
    return eventApproved(event.data) ? "approval.approved" : "approval.rejected";
  }
  return event.type;
}

function eventApproved(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { approved?: unknown }).approved === true,
  );
}

function principalFromActorId(actorId: string | undefined): EventPrincipalRef | undefined {
  return actorId ? { id: actorId, type: "human" } : undefined;
}

function principalFromTransaction(transaction: TransactionRecord): EventPrincipalRef | undefined {
  const actor = transaction.context.actor;
  return actor
    ? {
        id: actor.id,
        type: actor.type,
        displayName: actor.displayName,
      }
    : undefined;
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function defaultIdFactory(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
