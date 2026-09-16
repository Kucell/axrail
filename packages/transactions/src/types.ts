import type { ArtifactProviderRegistry, ArtifactRef } from "@axrail/artifacts";
import type { ActorRef, ChangeSet } from "@axrail/changesets";
import type { ValidationResult } from "@axrail/validation";

export type TransactionState =
  | "created"
  | "preparing"
  | "prepared"
  | "policy_checked"
  | "validated"
  | "awaiting_approval"
  | "approved"
  | "applying"
  | "verifying"
  | "committed"
  | "rejected"
  | "failed"
  | "conflicted"
  | "rolling_back"
  | "rolled_back"
  | "partially_applied"
  | "cancelled";

export type TransactionMode = "atomic" | "compensating" | "best_effort";

export interface TransactionContext {
  readonly actor?: ActorRef;
  readonly environment?: string;
  readonly adapterIds?: readonly string[];
  readonly expectedVersions?: Readonly<Record<string, string>>;
  readonly sessionId?: string;
  readonly correlationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface TransactionRecord {
  readonly id: string;
  readonly changeSet: ChangeSet;
  readonly state: TransactionState;
  readonly mode: TransactionMode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly context: TransactionContext;
  readonly baselineVersions: Readonly<Record<string, string | undefined>>;
  readonly validation?: ValidationResult;
  readonly error?: TransactionFailure;
}

export interface TransactionFailure {
  readonly code: TransactionFailureCode;
  readonly message: string;
  readonly cause?: unknown;
}

export type TransactionFailureCode =
  | "policy_unavailable"
  | "policy_denied"
  | "approval_unavailable"
  | "approval_denied"
  | "validation_failed"
  | "version_conflict"
  | "artifact_unavailable"
  | "execution_failed"
  | "verification_failed"
  | "commit_failed"
  | "rollback_failed"
  | "invalid_state"
  | "cancelled";

export interface TransactionPolicyDecision {
  readonly effect: "allow" | "deny" | "require_approval";
  readonly reason?: string;
}

export interface TransactionPolicyEvaluator {
  evaluate(transaction: TransactionRecord): Promise<TransactionPolicyDecision> | TransactionPolicyDecision;
}

export interface TransactionApprovalProvider {
  approve(transaction: TransactionRecord): Promise<boolean> | boolean;
}

export interface TransactionApplyResult {
  readonly externalRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TransactionRollbackResult {
  readonly complete: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TransactionExecutor {
  readonly id: string;
  readonly mode: TransactionMode;
  prepare?(transaction: TransactionRecord): Promise<void> | void;
  apply(transaction: TransactionRecord): Promise<TransactionApplyResult> | TransactionApplyResult;
  verify?(transaction: TransactionRecord, result: TransactionApplyResult): Promise<boolean> | boolean;
  commit?(transaction: TransactionRecord, result: TransactionApplyResult): Promise<void> | void;
  rollback?(transaction: TransactionRecord, result?: TransactionApplyResult): Promise<TransactionRollbackResult> | TransactionRollbackResult;
}

export interface TransactionEvent {
  readonly type: string;
  readonly transactionId: string;
  readonly changeSetId: string;
  readonly sessionId?: string;
  readonly correlationId?: string;
  readonly artifactRefs: readonly string[];
  readonly time: string;
  readonly state: TransactionState;
  readonly data?: unknown;
}

export interface TransactionRuntimeOptions {
  readonly executor: TransactionExecutor;
  readonly artifacts?: ArtifactProviderRegistry;
  readonly policy?: TransactionPolicyEvaluator;
  readonly approval?: TransactionApprovalProvider;
  readonly validate?: (changeSet: ChangeSet, transaction: TransactionRecord) => Promise<ValidationResult>;
  readonly onEvent?: (event: TransactionEvent) => Promise<void> | void;
  readonly allowWithoutPolicy?: boolean;
  readonly idFactory?: () => string;
  readonly now?: () => string;
}

export function artifactVersionKey(ref: ArtifactRef): string {
  return ref.provider ? `${ref.provider}:${ref.id}` : ref.id;
}
