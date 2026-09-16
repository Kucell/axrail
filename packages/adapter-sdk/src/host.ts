import type { ApprovalProvider } from "@axrail/approval";
import { ArtifactProviderRegistry } from "@axrail/artifacts";
import { PolicyEngine } from "@axrail/policy";
import { ToolRegistry } from "@axrail/tools";
import { ValidationPipeline } from "@axrail/validation";
import { AdapterContextRegistry } from "./context-registry.js";
import { AdapterRegistry } from "./registry.js";
import type {
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
        disposers.push(this.tools.register(tool));
        toolNames.push(tool.name);
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
        this.validation.register(validator);
        validatorIds.push(validator.id);
        disposers.push(() => {
          this.validation.unregister(validator.id);
        });
      }

      const policyProviderIds: string[] = [];
      for (const provider of adapter.policies?.() ?? []) {
        this.policy.register(provider);
        policyProviderIds.push(provider.id);
        disposers.push(() => {
          this.policy.unregister(provider.id);
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

  async unmount(
    adapterId: string,
    context: AdapterLifecycleContext = {},
  ): Promise<void> {
    const record = this.mounted.get(adapterId);
    if (!record) return;

    // Stop new external behavior first, then remove local registrations.
    let stopError: unknown;
    try {
      await this.registry.stop(adapterId, context);
    } catch (error) {
      stopError = error;
    }

    disposeReverse(record.disposers);
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
