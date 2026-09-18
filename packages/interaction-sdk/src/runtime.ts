import {
  assertSelectionProvider,
  type AdapterContextFragment,
} from "@axrail/adapter-sdk";
import type { AgentEvent } from "@axrail/agent";
import {
  buildInteractionContextEnvelope,
  mergeInteractionSystemPrompt,
} from "./context.js";
import { InteractionPluginHost } from "./plugin-host.js";
import type {
  InteractionContextFragment,
  InteractionEvent,
  InteractionEventListener,
  InteractionPlugin,
  InteractionResult,
  InteractionRuntimeOptions,
  InteractionSendInput,
  InteractionTurnContext,
} from "./types.js";

const DEFAULT_MAX_CONTEXT_CHARS = 50_000;

export class InteractionRuntime {
  readonly plugins = new InteractionPluginHost();

  private readonly harness: InteractionRuntimeOptions["harness"];
  private readonly model: InteractionRuntimeOptions["model"];
  private readonly systemPrompt?: string;
  private readonly maxSteps?: number;
  private readonly maxContextChars: number;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly listeners = new Set<InteractionEventListener>();

  constructor(options: InteractionRuntimeOptions) {
    this.harness = options.harness;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.maxSteps = options.maxSteps;
    this.maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    if (!Number.isInteger(this.maxContextChars) || this.maxContextChars < 1) {
      throw new Error("Interaction maxContextChars must be a positive integer");
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? defaultInteractionId;
  }

  subscribe(listener: InteractionEventListener): () => void {
    if (typeof listener !== "function") {
      throw new Error("Interaction event listener must be a function");
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async mount(plugin: InteractionPlugin): Promise<void> {
    const mounted = await this.plugins.mount(plugin);
    await this.emit({
      type: "interaction.plugin.mounted",
      time: this.now(),
      pluginId: mounted.id,
      data: { version: mounted.version },
    });
  }

  async unmount(pluginId: string): Promise<void> {
    const existed = this.plugins.has(pluginId);
    let cleanupError: unknown;

    try {
      await this.plugins.unmount(pluginId);
    } catch (error) {
      cleanupError = error;
    }

    if (existed) {
      await this.emit({
        type: "interaction.plugin.unmounted",
        time: this.now(),
        pluginId: pluginId.trim(),
      });
    }

    if (cleanupError) throw cleanupError;
  }

  async send(input: InteractionSendInput): Promise<InteractionResult> {
    const message = requiredText(input.message, "Interaction message");
    const providerId = requiredText(input.providerId, "Interaction providerId");
    const purpose = input.purpose?.trim() || "interaction";
    const artifactIds = Object.freeze(
      (input.artifactIds ?? []).map((id) =>
        requiredText(id, "Interaction artifact id"),
      ),
    );

    if (input.selection) {
      assertSelectionProvider(input.selection, providerId);
    }

    // Fail before model execution when the requested engineering provider is
    // not mounted/available.
    this.harness.adapters.get(providerId);

    const interactionId = this.idFactory();
    const context: InteractionTurnContext = Object.freeze({
      interactionId,
      providerId,
      purpose,
      artifactIds,
      selection: input.selection,
      actorId: input.actorId,
      sessionId: input.sessionId,
      signal: input.signal,
      includeSensitiveContext: input.includeSensitiveContext ?? false,
      metadata: input.metadata
        ? Object.freeze({ ...input.metadata })
        : undefined,
    });

    await this.emit({
      type: "interaction.turn.started",
      time: this.now(),
      interactionId,
      data: {
        providerId,
        purpose,
        selectionId: input.selection?.selectionId,
      },
    });

    try {
      await this.plugins.runBeforeTurn(context);

      const adapterFragments = await this.harness.adapters.buildContext(
        {
          purpose,
          artifactIds,
          selection: input.selection,
          metadata: input.metadata,
        },
        {
          adapterIds: [providerId],
          includeSensitive: input.includeSensitiveContext ?? false,
        },
      );

      const fragments: InteractionContextFragment[] = [];
      if (input.selection) {
        fragments.push(Object.freeze({
          source: "selection",
          providerId,
          kind: "axrail.selection.context",
          content: input.selection,
          sensitive: false,
        }));
      }

      for (const fragment of adapterFragments) {
        fragments.push(normalizeAdapterFragment(fragment, providerId));
      }

      fragments.push(...await this.plugins.collectContext(context));

      const envelope = buildInteractionContextEnvelope(
        fragments,
        this.maxContextChars,
      );

      await this.emit({
        type: "interaction.context.collected",
        time: this.now(),
        interactionId,
        data: {
          providerId,
          fragmentCount: fragments.length,
          envelopeChars: envelope.length,
        },
      });

      const agent = this.harness.createAgent({
        model: this.model,
        systemPrompt: mergeInteractionSystemPrompt(
          this.systemPrompt,
          envelope,
        ),
        maxSteps: this.maxSteps,
        onEvent: (event) => this.forwardAgentEvent(interactionId, event),
      });

      const agentResult = await agent.run(message, {
        sessionId: input.sessionId,
        actorId: input.actorId,
        providerIds: [providerId],
        signal: input.signal,
        metadata: {
          ...input.metadata,
          interactionId,
          interactionProviderId: providerId,
        },
      });

      const result: InteractionResult = Object.freeze({
        interactionId,
        providerId,
        status: agentResult.status,
        sessionId: agentResult.sessionId,
        agent: agentResult,
        context: Object.freeze({
          fragmentCount: fragments.length,
          envelopeChars: envelope.length,
        }),
      });

      await this.plugins.runAfterTurn(context, result);

      await this.emit({
        type: agentResult.status === "cancelled"
          ? "interaction.turn.cancelled"
          : "interaction.turn.completed",
        time: this.now(),
        interactionId,
        data: {
          providerId,
          status: agentResult.status,
          sessionId: agentResult.sessionId,
          steps: agentResult.steps,
        },
      });

      return result;
    } catch (error) {
      await this.emit({
        type: "interaction.turn.failed",
        time: this.now(),
        interactionId,
        data: {
          providerId,
          error: errorMessage(error),
        },
      });
      throw error;
    }
  }

  private async forwardAgentEvent(
    interactionId: string,
    event: AgentEvent,
  ): Promise<void> {
    await this.emit({
      type: "interaction.agent.event",
      time: this.now(),
      interactionId,
      data: { event },
    });
  }

  private async emit(event: InteractionEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch {
        // UI/application observers are non-authoritative.
      }
    }
    await this.plugins.notify(Object.freeze({ ...event }));
  }
}

function normalizeAdapterFragment(
  fragment: AdapterContextFragment,
  providerId: string,
): InteractionContextFragment {
  if (fragment.providerId !== providerId) {
    throw new Error(
      `Adapter Context provider mismatch: expected ${providerId}, got ${fragment.providerId}`,
    );
  }

  return Object.freeze({
    source: "adapter",
    providerId,
    kind: requiredText(fragment.kind, "Adapter Context kind"),
    content: fragment.content,
    sensitive: fragment.sensitive,
    metadata: fragment.metadata
      ? Object.freeze({ ...fragment.metadata })
      : undefined,
  });
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
  return value.trim();
}

function defaultInteractionId(): string {
  return `int_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
