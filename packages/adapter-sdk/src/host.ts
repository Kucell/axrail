import type { ApprovalProvider } from "@axrail/approval";
import { ArtifactProviderRegistry } from "@axrail/artifacts";
import {
  PolicyEngine,
  type PolicyInput,
  type PolicyProvider,
} from "@axrail/policy";
import { ToolRegistry, type ToolDefinition } from "@axrail/tools";
import { ValidationPipeline, type Validator } from "@axrail/validation";
import { AdapterContextRegistry } from "./context-registry.js";
import { AdapterRegistry } from "./registry.js";
import type {
  AdapterContextFragment,
  AdapterContextRequest,
  AdapterLifecycleContext,
  AdapterTransactionParticipant,
  AxrailAdapter,
  CapabilityManifest,
} from "./types.js";

export interface AdapterHostSurfaces {
  readonly tools?: ToolRegistry;
  readonly artifacts?: ArtifactProviderRegistry;
  readonly validation?: ValidationPipeline<unknown>;
  readonly policy?: PolicyEngine;
  readonly contexts?: AdapterContextRegistry;
}

export interface AdapterHostOptions extends AdapterHostSurfaces {
  readonly registry?: AdapterRegistry;
}

export interface AdapterContextBuildOptions {
  /** Explicit Adapter scope. Context is never implicitly aggregated globally. */
  readonly adapterIds: readonly string[];
  /** Sensitive fragments are excluded unless the caller explicitly opts in. */
  readonly includeSensitive?: boolean;
}

export interface MountedAdapter {
  readonly adapter: AxrailAdapter;
  readonly manifest: CapabilityManifest;
  readonly toolNames: readonly string[];
  readonly validatorIds: readonly string[];
  readonly policyProviderIds: readonly string[];
  readonly contextProviderIds: readonly string[];
  readonly artifactProviderId?: string;
  readonly approvals: readonly ApprovalProvider[];
  readonly transactionParticipant?: AdapterTransactionParticipant;
}

interface MutableMountedAdapter extends MountedAdapter {
  readonly disposers: Array<() => void>;
}

export class AdapterHost {
  readonly registry: AdapterRegistry;
  readonly tools: ToolRegistry;
  readonly artifacts: ArtifactProviderRegistry;
  readonly validation: ValidationPipeline<unknown>;
  readonly policy: PolicyEngine;
  readonly contexts: AdapterContextRegistry;

  private readonly mounted = new Map<string, MutableMountedAdapter>();

  constructor(options: AdapterHostOptions = {}) {
    this.registry = options.registry ?? new AdapterRegistry();
    this.tools = options.tools ?? new ToolRegistry();
    this.artifacts = options.artifacts ?? new ArtifactProviderRegistry();
    this.validation = options.validation ?? new ValidationPipeline<unknown>();
    this.policy = options.policy ?? new PolicyEngine();
    this.contexts = options.contexts ?? new AdapterContextRegistry();
  }

  async mount(
    adapter: AxrailAdapter,
    context: AdapterLifecycleContext = {},
  ): Promise<MountedAdapter> {
    if (this.mounted.has(adapter.id)) {
      throw new Error(`Adapter is already mounted: ${adapter.id}`);
    }

    const disposers: Array<() => void> = [];
    let registered = false;

    try {
      this.registry.register(adapter);
      registered = true;
      const initialized = await this.registry.initialize(adapter.id, context);
      if (!initialized.manifest) {
        throw new Error(`Adapter ${adapter.id} did not produce a capability manifest`);
      }

      const toolNames: string[] = [];
      for (const tool of adapter.tools?.() ?? []) {
        const bound = bindAdapterTool(adapter.id, tool);
        disposers.push(this.tools.register(bound));
        toolNames.push(bound.name);
      }

      let artifactProviderId: string | undefined;
      const artifactProvider = adapter.artifacts?.();
      if (artifactProvider) {
        this.artifacts.register(artifactProvider);
        artifactProviderId = artifactProvider.id;
        disposers.push(() => {
          this.artifacts.unregister(artifactProvider.id);
        });
      }

      const validatorIds: string[] = [];
      for (const validator of adapter.validators?.() ?? []) {
        const bound = bindAdapterValidator(adapter.id, validator);
        disposers.push(this.validation.register(bound));
        validatorIds.push(bound.id);
      }

      const policyProviderIds: string[] = [];
      for (const provider of adapter.policies?.() ?? []) {
        const bound = bindAdapterPolicy(adapter.id, provider);
        this.policy.register(bound);
        policyProviderIds.push(bound.id);
        disposers.push(() => {
          this.policy.unregister(bound.id);
        });
      }

      const contextProviderIds: string[] = [];
      for (const provider of adapter.context?.() ?? []) {
        disposers.push(this.contexts.register(adapter.id, provider));
        contextProviderIds.push(provider.id);
      }

      await this.registry.start(adapter.id, context);

      const record: MutableMountedAdapter = {
        adapter,
        manifest: initialized.manifest,
        toolNames,
        validatorIds,
        policyProviderIds,
        contextProviderIds,
        artifactProviderId,
        approvals: adapter.approvals?.() ?? [],
        transactionParticipant: adapter.transactions?.(),
        disposers,
      };
      this.mounted.set(adapter.id, record);
      return snapshot(record);
    } catch (error) {
      disposeReverse(disposers);
      if (registered) {
        try {
          const state = this.registry.get(adapter.id).state;
          if (state !== "registered" && state !== "stopped") {
            await this.registry.stop(adapter.id, context);
          }
        } catch {
          // The original mount error is authoritative. Cleanup remains best effort.
        }
        try {
          this.registry.unregister(adapter.id);
        } catch {
          // Preserve the original error.
        }
      }
      throw error;
    }
  }

  /**
   * Builds context only from explicitly selected mounted adapters. Sensitive
   * fragments remain excluded unless requested by the application. Axrail does
   * not automatically inject these fragments into model prompts.
   */
  async buildContext(
    request: AdapterContextRequest,
    options: AdapterContextBuildOptions,
  ): Promise<readonly AdapterContextFragment[]> {
    if (!options.adapterIds.length) {
      throw new Error("Adapter context retrieval requires at least one adapterId");
    }

    const fragments: AdapterContextFragment[] = [];
    for (const adapterId of new Set(options.adapterIds)) {
      this.get(adapterId); // Fail if the requested Adapter is not mounted/available.
      const built = await this.contexts.buildAll(request, adapterId);
      for (const fragment of built) {
        if (fragment.sensitive && !options.includeSensitive) continue;
        fragments.push(fragment);
      }
    }
    return fragments;
  }

  async unmount(
    adapterId: string,
    context: AdapterLifecycleContext = {},
  ): Promise<void> {
    const record = this.mounted.get(adapterId);
    if (!record) return;

    // Drain local provider surfaces before beginning external shutdown. New
    // Tool calls, validation, policy resolution, artifact access and context
    // lookups can no longer route into this adapter once stop() begins.
    disposeReverse(record.disposers);

    let stopError: unknown;
    try {
      await this.registry.stop(adapterId, context);
    } catch (error) {
      stopError = error;
    }

    this.mounted.delete(adapterId);

    try {
      this.registry.unregister(adapterId);
    } catch (error) {
      if (!stopError) stopError = error;
    }

    if (stopError) throw stopError;
  }

  get(adapterId: string): MountedAdapter {
    const record = this.mounted.get(adapterId);
    if (!record) throw new Error(`Mounted adapter not found: ${adapterId}`);
    return snapshot(record);
  }

  list(): readonly MountedAdapter[] {
    return [...this.mounted.values()].map(snapshot);
  }
}

function bindAdapterTool(
  adapterId: string,
  tool: ToolDefinition<unknown, unknown>,
): ToolDefinition<unknown, unknown> {
  if (tool.providerId && tool.providerId !== adapterId) {
    throw new Error(
      `Adapter ${adapterId} cannot register Tool ${tool.name} for provider ${tool.providerId}`,
    );
  }
  return Object.freeze({
    ...tool,
    providerId: adapterId,
  });
}

function bindAdapterValidator(
  adapterId: string,
  validator: Validator<unknown>,
): Validator<unknown> {
  if (validator.providerId && validator.providerId !== adapterId) {
    throw new Error(
      `Adapter ${adapterId} cannot register Validator ${validator.id} for provider ${validator.providerId}`,
    );
  }
  return Object.freeze({
    ...validator,
    providerId: adapterId,
  });
}

function bindAdapterPolicy(
  adapterId: string,
  provider: PolicyProvider<PolicyInput>,
): PolicyProvider<PolicyInput> {
  if (!provider.id) {
    throw new Error(`Adapter ${adapterId} Policy provider id must not be empty`);
  }
  return Object.freeze({
    id: `${adapterId}:${provider.id}`,
    order: provider.order,
    evaluate(input: PolicyInput) {
      if (input.adapterId !== adapterId) return undefined;
      return provider.evaluate(input);
    },
  });
}

function disposeReverse(disposers: Array<() => void>): void {
  for (const dispose of [...disposers].reverse()) {
    try {
      dispose();
    } catch {
      // Cleanup continues so one provider cannot leave the rest mounted.
    }
  }
  disposers.length = 0;
}

function snapshot(record: MutableMountedAdapter): MountedAdapter {
  return {
    adapter: record.adapter,
    manifest: record.manifest,
    toolNames: [...record.toolNames],
    validatorIds: [...record.validatorIds],
    policyProviderIds: [...record.policyProviderIds],
    contextProviderIds: [...record.contextProviderIds],
    artifactProviderId: record.artifactProviderId,
    approvals: [...record.approvals],
    transactionParticipant: record.transactionParticipant,
  };
}
