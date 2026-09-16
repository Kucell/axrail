import type { ApprovalProvider } from "@axrail/approval";
import type { ArtifactProvider } from "@axrail/artifacts";
import type { PolicyProvider } from "@axrail/policy";
import type { ToolDefinition } from "@axrail/tools";
import type { TransactionMode } from "@axrail/transactions";
import type { Validator } from "@axrail/validation";

export type CapabilitySupport =
  | { readonly level: "exact" }
  | { readonly level: "compatible"; readonly notes?: string }
  | { readonly level: "degraded"; readonly notes: string }
  | { readonly level: "unsupported"; readonly reason?: string };

export interface CapabilityManifest {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly protocolVersion?: string;
  readonly target?: {
    readonly vendor?: string;
    readonly product?: string;
    readonly version?: string;
  };
  readonly capabilities: Readonly<Record<string, CapabilitySupport>>;
  readonly featureFlags?: readonly string[];
}

export interface AdapterContextRequest {
  readonly purpose: string;
  readonly artifactIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AdapterContextFragment {
  readonly providerId: string;
  readonly kind: string;
  readonly content: unknown;
  readonly sensitive?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AdapterContextProvider {
  readonly id: string;
  build(request: AdapterContextRequest): Promise<AdapterContextFragment>;
}

/**
 * Experimental v0.1 surface. Harness does not yet orchestrate multi-adapter
 * transaction participants; adapters should prefer governed Tool/Transaction
 * executors until participant selection and composition semantics are frozen.
 */
export interface AdapterTransactionParticipant {
  readonly mode: TransactionMode;
  prepare?(transactionId: string): Promise<void>;
  commit?(transactionId: string): Promise<void>;
  rollback?(transactionId: string): Promise<void>;
}

export interface AdapterLifecycleContext {
  readonly environment?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AxrailAdapter {
  readonly id: string;
  readonly version: string;

  capabilities(): Promise<CapabilityManifest>;

  tools?(): readonly ToolDefinition<unknown, unknown>[];
  artifacts?(): ArtifactProvider;
  /**
   * Context providers are available through explicit Harness context retrieval.
   * Axrail does not automatically inject returned content into model prompts.
   */
  context?(): readonly AdapterContextProvider[];
  validators?(): readonly Validator<unknown>[];
  policies?(): readonly PolicyProvider[];
  /**
   * Experimental v0.1 surface. Adapter-provided approval providers are mounted
   * for discovery but are not automatically selected by Harness governance.
   * Applications should configure the Harness ApprovalService explicitly.
   */
  approvals?(): readonly ApprovalProvider[];
  /** Experimental v0.1 surface; see AdapterTransactionParticipant. */
  transactions?(): AdapterTransactionParticipant;

  initialize?(context: AdapterLifecycleContext): Promise<void> | void;
  start?(context: AdapterLifecycleContext): Promise<void> | void;
  stop?(context: AdapterLifecycleContext): Promise<void> | void;
}

export type AdapterLifecycleState =
  | "registered"
  | "initializing"
  | "ready"
  | "active"
  | "stopping"
  | "stopped"
  | "failed";

export interface AdapterRecord {
  readonly adapter: AxrailAdapter;
  readonly state: AdapterLifecycleState;
  readonly manifest?: CapabilityManifest;
  readonly error?: Error;
}
