import {
  ModelRegistry,
  type InteractionModelRegistration,
} from "./models.js";
import type {
  InteractionAfterTurnHook,
  InteractionBeforeTurnHook,
  InteractionContextContributor,
  InteractionContextFragment,
  InteractionEvent,
  InteractionEventListener,
  InteractionPlugin,
  InteractionPluginApi,
  InteractionPluginHostSnapshot,
  InteractionResult,
  InteractionTurnContext,
  MountedInteractionPlugin,
} from "./types.js";

interface MountedPluginRecord {
  readonly plugin: InteractionPlugin;
  readonly registrations: readonly (() => void)[];
  readonly cleanup?: () => Promise<void> | void;
}

interface HookRecord<T> {
  readonly owner: string;
  readonly hook: T;
}

interface ListenerRecord {
  readonly owner: string;
  readonly listener: InteractionEventListener;
}

interface ContributorRecord {
  readonly owner: string;
  readonly contributor: InteractionContextContributor;
}

export class InteractionPluginHost {
  readonly models: ModelRegistry;

  private readonly mounted = new Map<string, MountedPluginRecord>();
  private readonly contributors = new Map<string, ContributorRecord>();
  private readonly beforeHooks: HookRecord<InteractionBeforeTurnHook>[] = [];
  private readonly afterHooks: HookRecord<InteractionAfterTurnHook>[] = [];
  private readonly eventListeners: ListenerRecord[] = [];

  constructor(models: ModelRegistry = new ModelRegistry()) {
    this.models = models;
  }

  async mount(plugin: InteractionPlugin): Promise<MountedInteractionPlugin> {
    const pluginId = requiredId(plugin.id, "Interaction plugin id");
    if (this.mounted.has(pluginId)) {
      throw new Error(`Interaction plugin already mounted: ${pluginId}`);
    }

    const registrations: (() => void)[] = [];
    const api = this.createApi(pluginId, registrations);

    try {
      const cleanup = await plugin.setup(api);
      if (cleanup !== undefined && typeof cleanup !== "function") {
        throw new Error(
          `Interaction plugin ${pluginId} setup must return void or a cleanup function`,
        );
      }
      const cleanupFn = typeof cleanup === "function"
        ? cleanup
        : undefined;

      this.mounted.set(pluginId, {
        plugin,
        registrations: registrations.slice(),
        cleanup: cleanupFn,
      });
      return freezePlugin(plugin);
    } catch (error) {
      disposeReverse(registrations);
      throw error;
    }
  }

  async unmount(pluginId: string): Promise<boolean> {
    const id = requiredId(pluginId, "Interaction plugin id");
    const record = this.mounted.get(id);
    if (!record) return false;

    // Remove extension surfaces before external/plugin cleanup begins.
    this.mounted.delete(id);
    disposeReverse(record.registrations);

    if (record.cleanup) {
      await record.cleanup();
    }
    return true;
  }

  has(pluginId: string): boolean {
    return this.mounted.has(requiredId(pluginId, "Interaction plugin id"));
  }

  list(): readonly MountedInteractionPlugin[] {
    return [...this.mounted.values()].map((record) => freezePlugin(record.plugin));
  }

  snapshot(): InteractionPluginHostSnapshot {
    return Object.freeze({
      plugins: Object.freeze(this.list().slice()),
      contextContributors: Object.freeze([...this.contributors.keys()]),
      modelIds: Object.freeze(this.models.list().map((model) => model.id)),
    });
  }

  async collectContext(
    context: InteractionTurnContext,
  ): Promise<readonly InteractionContextFragment[]> {
    const fragments: InteractionContextFragment[] = [];

    for (const [id, record] of this.contributors) {
      const value = await record.contributor.contribute(context);
      const contributions = value === undefined
        ? []
        : Array.isArray(value)
          ? value
          : [value];

      for (const contribution of contributions) {
        if (contribution.sensitive && !context.includeSensitiveContext) continue;
        fragments.push(Object.freeze({
          source: "plugin",
          providerId: context.providerId,
          kind: requiredId(contribution.kind, "Interaction context kind"),
          content: contribution.content,
          sensitive: contribution.sensitive,
          contributorId: id,
          metadata: contribution.metadata
            ? Object.freeze({ ...contribution.metadata })
            : undefined,
        }));
      }
    }

    return Object.freeze(fragments);
  }

  async runBeforeTurn(context: InteractionTurnContext): Promise<void> {
    for (const record of this.beforeHooks) {
      await record.hook(context);
    }
  }

  async runAfterTurn(
    context: InteractionTurnContext,
    result: InteractionResult,
  ): Promise<void> {
    for (const record of this.afterHooks) {
      try {
        await record.hook(context, result);
      } catch {
        // Post-turn extensions are observational. They cannot rewrite the
        // authoritative Harness Agent result after execution has completed.
      }
    }
  }

  async notify(event: InteractionEvent): Promise<void> {
    for (const record of this.eventListeners) {
      try {
        await record.listener(event);
      } catch {
        // Interaction/UI observers are non-authoritative.
      }
    }
  }

  private createApi(
    owner: string,
    registrations: (() => void)[],
  ): InteractionPluginApi {
    const remember = (dispose: () => void): (() => void) => {
      const once = onceDisposer(dispose);
      registrations.push(once);
      return once;
    };

    return Object.freeze({
      registerModel: (registration: InteractionModelRegistration) => {
        return remember(this.models.register(registration));
      },

      registerContextContributor: (
        contributor: InteractionContextContributor,
      ): (() => void) => {
        const id = requiredId(
          contributor.id,
          "Interaction context contributor id",
        );
        if (this.contributors.has(id)) {
          throw new Error(
            `Interaction context contributor already registered: ${id}`,
          );
        }
        this.contributors.set(id, { owner, contributor });
        return remember(() => {
          const current = this.contributors.get(id);
          if (current?.owner === owner) this.contributors.delete(id);
        });
      },

      registerBeforeTurn: (
        hook: InteractionBeforeTurnHook,
      ): (() => void) => {
        if (typeof hook !== "function") {
          throw new Error("Interaction before-turn hook must be a function");
        }
        const record = { owner, hook };
        this.beforeHooks.push(record);
        return remember(() => removeRecord(this.beforeHooks, record));
      },

      registerAfterTurn: (
        hook: InteractionAfterTurnHook,
      ): (() => void) => {
        if (typeof hook !== "function") {
          throw new Error("Interaction after-turn hook must be a function");
        }
        const record = { owner, hook };
        this.afterHooks.push(record);
        return remember(() => removeRecord(this.afterHooks, record));
      },

      onEvent: (
        listener: InteractionEventListener,
      ): (() => void) => {
        if (typeof listener !== "function") {
          throw new Error("Interaction event listener must be a function");
        }
        const record = { owner, listener };
        this.eventListeners.push(record);
        return remember(() => removeRecord(this.eventListeners, record));
      },
    });
  }
}

function freezePlugin(plugin: InteractionPlugin): MountedInteractionPlugin {
  return Object.freeze({
    id: plugin.id.trim(),
    version: plugin.version,
  });
}

function requiredId(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
  return value.trim();
}

function onceDisposer(dispose: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    dispose();
  };
}

function disposeReverse(disposers: readonly (() => void)[]): void {
  for (let index = disposers.length - 1; index >= 0; index -= 1) {
    try {
      disposers[index]();
    } catch {
      // Registration cleanup is best-effort and must not mask the original
      // setup failure. Internal registrations are expected not to throw.
    }
  }
}

function removeRecord<T>(records: T[], record: T): void {
  const index = records.indexOf(record);
  if (index >= 0) records.splice(index, 1);
}
