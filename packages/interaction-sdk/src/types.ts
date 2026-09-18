import type {
  AdapterContextFragment,
  SelectionContext,
} from "@axrail/adapter-sdk";
import type {
  AgentEvent,
  AgentModelProvider,
  AgentRunResult,
} from "@axrail/agent";
import type { HarnessRuntime } from "@axrail/harness";
import type {
  InteractionModelCapability,
  InteractionModelDescriptor,
  InteractionModelProvenance,
  InteractionModelRegistration,
  ModelRegistry,
} from "./models.js";

export type InteractionTurnStatus =
  | "completed"
  | "max_steps"
  | "cancelled";

export interface InteractionRuntimeOptions {
  readonly harness: HarnessRuntime;
  /**
   * Backward-compatible single-model convenience. The runtime registers this
   * provider using provider.id as both logical model ID and provider label.
   */
  readonly model?: AgentModelProvider;
  /**
   * Optional externally owned registry for advanced applications/plugins.
   * When omitted, InteractionRuntime creates its own registry.
   */
  readonly models?: ModelRegistry;
  /**
   * Constructor-level default only. Applications should pass modelId per turn
   * for user-specific selection instead of mutating global runtime state.
   */
  readonly defaultModelId?: string;
  readonly systemPrompt?: string;
  readonly maxSteps?: number;
  /**
   * Maximum character length of the generated interaction context envelope.
   * Oversized context fails closed instead of being silently truncated.
   */
  readonly maxContextChars?: number;
  readonly now?: () => string;
  readonly idFactory?: () => string;
}

export interface InteractionSendInput {
  readonly message: string;
  readonly providerId: string;
  /** Explicit logical model selection for this turn. */
  readonly modelId?: string;
  /** Required capabilities must be explicitly declared true by the model. */
  readonly requiredModelCapabilities?: readonly InteractionModelCapability[];
  readonly purpose?: string;
  readonly artifactIds?: readonly string[];
  readonly selection?: SelectionContext;
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly includeSensitiveContext?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InteractionTurnContext {
  readonly interactionId: string;
  readonly providerId: string;
  readonly model: InteractionModelDescriptor;
  readonly modelProvenance: InteractionModelProvenance;
  readonly purpose: string;
  readonly artifactIds: readonly string[];
  readonly selection?: SelectionContext;
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly includeSensitiveContext: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InteractionContextContribution {
  readonly kind: string;
  readonly content: unknown;
  readonly sensitive?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InteractionContextFragment {
  readonly source: "selection" | "adapter" | "plugin";
  readonly providerId: string;
  readonly kind: string;
  readonly content: unknown;
  readonly sensitive?: boolean;
  readonly contributorId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface InteractionContextContributor {
  readonly id: string;
  contribute(
    context: InteractionTurnContext,
  ):
    | InteractionContextContribution
    | readonly InteractionContextContribution[]
    | undefined
    | Promise<
        | InteractionContextContribution
        | readonly InteractionContextContribution[]
        | undefined
      >;
}

export type InteractionBeforeTurnHook = (
  context: InteractionTurnContext,
) => Promise<void> | void;

export interface InteractionResult {
  readonly interactionId: string;
  readonly providerId: string;
  readonly model: InteractionModelProvenance;
  readonly status: InteractionTurnStatus;
  readonly sessionId: string;
  readonly agent: AgentRunResult;
  readonly context: {
    readonly fragmentCount: number;
    readonly envelopeChars: number;
  };
}

export type InteractionAfterTurnHook = (
  context: InteractionTurnContext,
  result: InteractionResult,
) => Promise<void> | void;

export interface InteractionEvent {
  readonly type:
    | "interaction.plugin.mounted"
    | "interaction.plugin.unmounted"
    | "interaction.model.selected"
    | "interaction.turn.started"
    | "interaction.context.collected"
    | "interaction.agent.event"
    | "interaction.turn.completed"
    | "interaction.turn.cancelled"
    | "interaction.turn.failed";
  readonly time: string;
  readonly interactionId?: string;
  readonly pluginId?: string;
  readonly data?: unknown;
}

export type InteractionEventListener = (
  event: InteractionEvent,
) => Promise<void> | void;

export interface InteractionPluginApi {
  registerModel(
    registration: InteractionModelRegistration,
  ): () => void;

  registerContextContributor(
    contributor: InteractionContextContributor,
  ): () => void;

  registerBeforeTurn(
    hook: InteractionBeforeTurnHook,
  ): () => void;

  registerAfterTurn(
    hook: InteractionAfterTurnHook,
  ): () => void;

  onEvent(
    listener: InteractionEventListener,
  ): () => void;
}

export interface InteractionPlugin {
  readonly id: string;
  readonly version?: string;
  setup(
    api: InteractionPluginApi,
  ):
    | void
    | (() => Promise<void> | void)
    | Promise<void | (() => Promise<void> | void)>;
}

export interface MountedInteractionPlugin {
  readonly id: string;
  readonly version?: string;
}

export interface InteractionPluginHostSnapshot {
  readonly plugins: readonly MountedInteractionPlugin[];
  readonly contextContributors: readonly string[];
  readonly modelIds: readonly string[];
}

export interface InteractionAdapterContextSource {
  readonly fragments: readonly AdapterContextFragment[];
}

export interface InteractionAgentEventPayload {
  readonly event: AgentEvent;
}
