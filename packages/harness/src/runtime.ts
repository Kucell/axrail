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
  type ToolInvocationEnvelope,
  type ToolPolicyDecision,
  type ToolPolicyEvaluator,
  type ToolRuntimeEvent,
} from "@axrail/tools";
import {
  TransactionRuntime,
  createTransactionApprovalProvider,
  createTransactionPolicyEvaluator,
  type TransactionContext,
  type TransactionEvent,
  type TransactionExecutor,
  type TransactionRecord,
  type TransactionRuntimeOptions,
} from "@axrail/transactions";
import {
  requiresAuditBeforeCommit,
  requiresAuditBeforeEffect,
  type AuditFailurePolicy,
} from "./audit.js";
import { HarnessAgent, type HarnessAgentOptions } from "./agent.js";

export interface HarnessRuntimeOptions {
  readonly adapterHost?: AdapterHost;
  readonly adapterHostOptions?: AdapterHostOptions;
  readonly eventStore?: EventStore;
  readonly approval?: ApprovalService;
  readonly environment?: string;
  readonly auditPolicy?: AuditFailurePolicy;
  readonly now?: () => string;
  readonly idFactory?: (prefix: string) => string;
}

export interface HarnessTransactionRuntimeOptions {
  readonly executor: TransactionExecutor;
  readonly allowWithoutPolicy?: boolean;
  readonly requiredApprovers?: readonly ApprovalRequirement[];
  readonly onEvent?: TransactionRuntimeOptions["onEvent"];
}

export type HarnessChangeSet = Parameters<TransactionRuntime["execute"]>[0];

export interface ProviderBoundTransactionExecutor extends TransactionExecutor {
  readonly providerId: string;
}

export interface HarnessChangeSetExecutionOptions {
  /**
   * Effecting executor and authoritative provider identity for this high-level
   * mutation. Harness derives Adapter Policy/Validation scope from providerId.
   */
  readonly executor: ProviderBoundTransactionExecutor;
  readonly allowWithoutPolicy?: boolean;
  readonly requiredApprovers?: readonly ApprovalRequirement[];
  readonly onEvent?: TransactionRuntimeOptions["onEvent"];
  readonly actor?: TransactionContext["actor"];
  readonly environment?: string;
  readonly expectedVersions?: TransactionContext["expectedVersions"];
  readonly sessionId?: string;
  readonly correlationId?: string;
  readonly metadata?: TransactionContext["metadata"];
  readonly signal?: AbortSignal;
}

export class HarnessRuntime {
  readonly adapters: AdapterHost;
  readonly events: EventStore;
  readonly sessions: SessionService;
  readonly tools: ToolRuntime;
  readonly approval?: ApprovalService;
  readonly environment?: string;
  readonly auditPolicy: AuditFailurePolicy;

  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;

  constructor(options: HarnessRuntimeOptions = {}) {
    this.adapters = options.adapterHost ?? new AdapterHost(options.adapterHostOptions);
    this.events = options.eventStore ?? new InMemoryEventStore();
    this.approval = options.approval;
    this.environment = options.environment;
    this.auditPolicy = options.auditPolicy ?? "best_effort";
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
      beforeExecute: requiresAuditBeforeEffect(this.auditPolicy)
        ? (invocation) => this.recordToolAuditCheckpoint(invocation)
        : undefined,
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
          providerIds: transaction.context.adapterIds,
          signal: transaction.context.signal,
          metadata: {
            transactionId: transaction.id,
            mode: transaction.mode,
            sessionId: transaction.context.sessionId,
            correlationId: transaction.context.correlationId,
          },
        }),
      beforeApply: requiresAuditBeforeEffect(this.auditPolicy)
        ? (transaction) => this.recordTransactionAuditCheckpoint("effect", transaction)
        : undefined,
      beforeCommit: requiresAuditBeforeCommit(this.auditPolicy)
        ? (transaction) => this.recordTransactionAuditCheckpoint("commit", transaction)
        : undefined,
      onEvent: async (event, transaction) => {
        await this.recordTransactionEvent(event, transaction);
        try {
          await options.onEvent?.(event, transaction);
        } catch {
          // Observer instrumentation remains non-authoritative. Strict audit
          // guarantees are enforced by the explicit checkpoints above.
        }
      },
    });
  }

  /**
   * High-level governed path for durable engineering ChangeSets.
   *
   * This composes the existing TransactionRuntime rather than introducing a
   * second mutation engine. The executor's providerId is authoritative: the
   * corresponding Adapter must be mounted and is used to scope Policy and
   * Validation. Explicit Artifact providers must not conflict with it.
   */
  async executeChangeSet(
    changeSet: HarnessChangeSet,
    options: HarnessChangeSetExecutionOptions,
  ): Promise<TransactionRecord> {
    const providerId = options.executor.providerId;
    if (!providerId) {
      throw new Error("Provider-bound TransactionExecutor requires a non-empty providerId");
    }

    this.adapters.get(providerId);
    assertChangeSetProviderBinding(changeSet, providerId);

    const runtime = this.createTransactionRuntime({
      executor: options.executor,
      allowWithoutPolicy: options.allowWithoutPolicy,
      requiredApprovers: options.requiredApprovers,
      onEvent: options.onEvent,
    });

    return runtime.execute(changeSet, {
      actor: options.actor,
      environment: options.environment ?? this.environment,
      adapterIds: [providerId],
      expectedVersions: options.expectedVersions,
      sessionId: options.sessionId,
      correlationId: options.correlationId,
      metadata: options.metadata,
      signal: options.signal,
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

  toolPolicyInput(invocation: ToolInvocationEnvelope): PolicyInput {
    return {
      action: invocation.toolName,
      actor: invocation.context.actorId
        ? { id: invocation.context.actorId, type: "user" }
        : undefined,
      risk: invocation.risk,
      environment: invocation.context.environment ?? this.environment,
      adapterId: invocation.providerId,
      capability: invocation.toolName,
      resource: invocation.target
        ? {
            id: invocation.target,
            provider: invocation.providerId,
            metadata: invocation.artifactRefs
              ? { artifactRefs: invocation.artifactRefs }
              : undefined,
          }
        : undefined,
      facts: {
        effect: invocation.effect,
        sessionId: invocation.context.sessionId,
        transactionId: invocation.context.transactionId,
        evidenceDigest: invocation.evidenceDigest,
        effectiveInput: invocation.input,
        artifactRefs: invocation.artifactRefs,
        toolVersion: invocation.toolVersion,
        providerId: invocation.providerId,
      },
    };
  }

  toolApprovalPrincipal(
    invocation: ToolInvocationEnvelope,
  ): ApprovalPrincipal | undefined {
    return invocation.context.actorId
      ? { id: invocation.context.actorId, type: "human" }
      : undefined;
  }

  nextId(prefix: string): string {
    return this.idFactory(prefix);
  }

  currentTime(): string {
    return this.now();
  }

  private async recordToolAuditCheckpoint(
    invocation: ToolInvocationEnvelope,
  ): Promise<void> {
    await this.events.append({
      id: this.nextId("evt"),
      type: "audit.effect.checkpoint",
      version: "1",
      time: this.currentTime(),
      sessionId: invocation.context.sessionId,
      transactionId: invocation.context.transactionId,
      toolCallId: invocation.callId,
      artifactRefs: invocation.artifactRefs,
      actor: principalFromActorId(invocation.context.actorId),
      source: "harness-audit",
      correlationId: metadataString(invocation.context.metadata, "correlationId"),
      data: {
        auditPolicy: this.auditPolicy,
        toolName: invocation.toolName,
        providerId: invocation.providerId,
        evidenceDigest: invocation.evidenceDigest,
        target: invocation.target,
        risk: invocation.risk,
        effect: invocation.effect,
      },
    });
  }

  private async recordTransactionAuditCheckpoint(
    phase: "effect" | "commit",
    transaction: TransactionRecord,
  ): Promise<void> {
    await this.events.append({
      id: this.nextId("evt"),
      type: phase === "commit" ? "audit.commit.checkpoint" : "audit.effect.checkpoint",
      version: "1",
      time: this.currentTime(),
      sessionId: transaction.context.sessionId,
      transactionId: transaction.id,
      changeSetId: transaction.changeSet.id,
      artifactRefs: transaction.changeSet.artifacts.map((artifact) => artifact.id),
      actor: principalFromTransaction(transaction),
      source: "harness-audit",
      correlationId: transaction.context.correlationId,
      data: {
        auditPolicy: this.auditPolicy,
        phase,
        mode: transaction.mode,
        approvedEvidenceDigest: transaction.approvedEvidenceDigest,
      },
    });
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
        artifactRefs: event.artifactRefs,
        actor: principalFromActorId(event.actorId),
        source: "tool-runtime",
        correlationId: event.correlationId,
        data: {
          toolName: event.toolName,
          providerId: event.providerId,
          evidenceDigest: event.evidenceDigest,
          target: event.target,
          detail: event.data,
        },
      });
    } catch {
      // Ordinary lifecycle events are observational. Strict profiles enforce
      // durable guarantees through explicit checkpoints before side effects.
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
      // See recordToolEvent. Strict guarantees are provided by checkpoints.
    }
  }
}

class HarnessToolPolicy implements ToolPolicyEvaluator {
  constructor(private readonly harness: HarnessRuntime) {}

  async evaluate(
    invocation: ToolInvocationEnvelope,
  ): Promise<ToolPolicyDecision> {
    const providers = this.harness.adapters.policy.list();

    if (providers.length === 0) {
      if (invocation.risk === "L0" || invocation.risk === "L1") {
        return { allow: true };
      }
      return {
        allow: false,
        code: "policy_unavailable",
        reason: `No policy provider is registered for privileged tool ${invocation.toolName} (${invocation.risk})`,
      };
    }

    const decision = await this.harness.adapters.policy.evaluate(
      this.harness.toolPolicyInput(invocation),
    );

    if (decision.effect === "deny") {
      return {
        allow: false,
        code: "policy_denied",
        reason: decision.reason,
        obligations: decision.obligations,
      };
    }

    return {
      allow: true,
      requireApproval: decision.effect === "require-approval",
      reason: decision.reason,
      obligations: decision.obligations,
    };
  }
}

class HarnessToolApproval implements ToolApprovalProvider {
  constructor(private readonly harness: HarnessRuntime) {}

  async approve(invocation: ToolInvocationEnvelope): Promise<boolean> {
    if (!this.harness.approval) return false;

    const request = {
      id: this.harness.nextId("approval"),
      transactionId: invocation.context.transactionId,
      toolCallId: invocation.callId,
      actor: this.harness.toolApprovalPrincipal(invocation),
      operation: {
        action: invocation.toolName,
        target: invocation.target,
        description: invocation.toolDescription,
        metadata: {
          effect: invocation.effect,
          providerId: invocation.providerId,
          toolVersion: invocation.toolVersion,
        },
      },
      risk: invocation.risk,
      reason: `Policy requires approval for ${invocation.toolName}`,
      evidence: {
        metadata: {
          toolName: invocation.toolName,
          providerId: invocation.providerId,
          toolVersion: invocation.toolVersion,
          artifactRefs: invocation.artifactRefs,
          invocation: invocation.descriptionMetadata,
        },
      },
      evidenceDigest: invocation.evidenceDigest,
      metadata: {
        sessionId: invocation.context.sessionId,
        environment: invocation.context.environment ?? this.harness.environment,
      },
    } as const;

    const decision = await this.harness.approval.request(request);
    return isApprovalGranted(request, decision, this.harness.currentTime());
  }
}

function assertChangeSetProviderBinding(
  changeSet: HarnessChangeSet,
  providerId: string,
): void {
  for (const artifact of changeSet.artifacts) {
    if (artifact.provider && artifact.provider !== providerId) {
      throw new Error(
        `ChangeSet artifact provider mismatch for ${artifact.id}: executor provider ${providerId}, artifact provider ${artifact.provider}`,
      );
    }
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
