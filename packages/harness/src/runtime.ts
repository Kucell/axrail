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
  isApprovalGranted,
} from "@axrail/approval";
import {
  InMemoryEventStore,
  SessionService,
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
} from "@axrail/tools";
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
    });
  }

  createAgent(options: HarnessAgentOptions): HarnessAgent {
    return new HarnessAgent(this, options);
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
