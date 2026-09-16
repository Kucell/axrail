import {
  digestChangeSet,
  snapshotChangeSet,
  type ChangeSet,
} from "@axrail/changesets";
import type { ValidationResult } from "@axrail/validation";
import { TransactionError, transactionMessage } from "./error.js";
import type {
  TransactionApplyResult,
  TransactionContext,
  TransactionEvent,
  TransactionFailureCode,
  TransactionRecord,
  TransactionRuntimeOptions,
  TransactionState,
} from "./types.js";
import { artifactVersionKey } from "./types.js";

const TERMINAL_STATES = new Set<TransactionState>([
  "committed",
  "rejected",
  "failed",
  "conflicted",
  "rolled_back",
  "partially_applied",
  "cancelled",
]);

export class TransactionRuntime {
  private readonly options: TransactionRuntimeOptions;

  constructor(options: TransactionRuntimeOptions) {
    this.options = options;
  }

  begin(changeSet: ChangeSet, context: TransactionContext = {}): TransactionHandle {
    const now = this.now();
    const record: MutableTransactionRecord = {
      id: this.options.idFactory?.() ?? defaultId(),
      changeSet: snapshotChangeSet(changeSet),
      state: "created",
      mode: this.options.executor.mode,
      createdAt: now,
      updatedAt: now,
      context,
      baselineVersions: {},
    };
    return new TransactionHandle(this.options, record, () => this.now());
  }

  async execute(changeSet: ChangeSet, context: TransactionContext = {}): Promise<TransactionRecord> {
    const tx = this.begin(changeSet, context);
    try {
      await tx.prepare();
      await tx.evaluatePolicy();
      await tx.validate();
      if (tx.needsApproval) await tx.requestApproval();
      await tx.apply();
      await tx.verify();
      await tx.commit();
    } catch {
      // State and failure are recorded by the phase that failed.
      // Recovery/rollback is intentionally explicit in v0.1 because adapters
      // may represent physical or non-atomic side effects.
    }
    return tx.snapshot();
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}

interface MutableTransactionRecord {
  id: string;
  changeSet: ChangeSet;
  state: TransactionState;
  mode: TransactionRecord["mode"];
  createdAt: string;
  updatedAt: string;
  context: TransactionContext;
  baselineVersions: Record<string, string | undefined>;
  approvedEvidenceDigest?: string;
  validation?: ValidationResult;
  error?: TransactionRecord["error"];
}

export class TransactionHandle {
  private applyResult?: TransactionApplyResult;
  private approvalRequired = false;

  constructor(
    private readonly options: TransactionRuntimeOptions,
    private readonly record: MutableTransactionRecord,
    private readonly now: () => string,
  ) {}

  get state(): TransactionState {
    return this.record.state;
  }

  get needsApproval(): boolean {
    return this.approvalRequired;
  }

  snapshot(): TransactionRecord {
    return {
      ...this.record,
      baselineVersions: { ...this.record.baselineVersions },
    };
  }

  async prepare(): Promise<void> {
    this.expect("created");
    await this.transition("preparing");
    this.throwIfCancelled();

    try {
      for (const artifact of this.record.changeSet.artifacts) {
        const key = artifactVersionKey(artifact);
        if (this.record.context.expectedVersions?.[key] !== undefined) {
          this.record.baselineVersions[key] = this.record.context.expectedVersions[key];
          continue;
        }
        if (artifact.version !== undefined) {
          this.record.baselineVersions[key] = artifact.version;
          continue;
        }
        if (this.options.artifacts) {
          const provider = this.options.artifacts.providerFor(artifact);
          this.record.baselineVersions[key] = await provider.currentVersion(artifact);
        }
      }
      await this.options.executor.prepare?.(this.snapshot());
      await this.transition("prepared");
    } catch (error) {
      await this.fail("artifact_unavailable", transactionMessage(error), error);
      throw error;
    }
  }

  async evaluatePolicy(): Promise<void> {
    this.expect("prepared");
    this.throwIfCancelled();

    if (!this.options.policy) {
      if (!this.options.allowWithoutPolicy) {
        await this.reject("policy_unavailable", "No transaction policy evaluator is configured");
        throw new TransactionError("policy_unavailable", "No transaction policy evaluator is configured");
      }
      await this.transition("policy_checked");
      return;
    }

    const decision = await this.options.policy.evaluate(this.snapshot());
    if (decision.effect === "deny") {
      const message = decision.reason ?? "Transaction denied by policy";
      await this.reject("policy_denied", message);
      throw new TransactionError("policy_denied", message);
    }
    this.approvalRequired = decision.effect === "require_approval";
    await this.transition("policy_checked", decision);
  }

  async validate(): Promise<void> {
    this.expect("policy_checked");
    this.throwIfCancelled();

    if (!this.options.validate) {
      const result: ValidationResult = { valid: true, issues: [], validatorsRun: [] };
      this.record.validation = result;
      await this.transition("validated", result);
      return;
    }

    const result = await this.options.validate(this.record.changeSet, this.snapshot());
    this.record.validation = result;
    if (!result.valid) {
      await this.fail("validation_failed", "Transaction validation failed", result);
      throw new TransactionError("validation_failed", "Transaction validation failed", result);
    }
    await this.transition("validated", result);
  }

  async requestApproval(): Promise<void> {
    this.expect("validated");
    if (!this.approvalRequired) {
      await this.transition("approved", { implicit: true });
      return;
    }
    await this.transition("awaiting_approval");
    if (!this.options.approval) {
      await this.fail("approval_unavailable", "Approval is required but no provider is configured");
      throw new TransactionError("approval_unavailable", "Approval is required but no provider is configured");
    }

    const approval = await this.options.approval.approve(this.snapshot());
    if (!approval.approved) {
      await this.reject("approval_denied", "Transaction approval was denied");
      throw new TransactionError("approval_denied", "Transaction approval was denied");
    }
    if (!approval.evidenceDigest) {
      const message = "Approved transaction is missing an evidence digest";
      await this.fail("approval_evidence_missing", message);
      throw new TransactionError("approval_evidence_missing", message);
    }

    this.record.approvedEvidenceDigest = approval.evidenceDigest;
    await this.verifyApprovedEvidence();
    await this.transition("approved", { evidenceDigest: approval.evidenceDigest });
  }

  async apply(): Promise<void> {
    if (this.record.state === "validated" && !this.approvalRequired) {
      await this.transition("approved", { implicit: true });
    }
    this.expect("approved");
    this.throwIfCancelled();

    if (this.approvalRequired) await this.verifyApprovedEvidence();

    // The last safe optimistic-concurrency check for all transaction modes.
    // Compensating/best-effort adapters may mutate the authoritative artifact
    // during apply(), so the baseline version is no longer a valid commit-time
    // comparison for those modes.
    await this.checkConcurrency();
    await this.transition("applying");

    try {
      this.applyResult = await this.options.executor.apply(this.snapshot());
    } catch (error) {
      await this.fail("execution_failed", transactionMessage(error), error);
      throw error;
    }
  }

  async verify(): Promise<void> {
    this.expect("applying");
    await this.transition("verifying");
    if (!this.options.executor.verify) return;
    try {
      const verified = await this.options.executor.verify(this.snapshot(), this.applyResult ?? {});
      if (!verified) {
        await this.fail("verification_failed", "Transaction verification failed");
        throw new TransactionError("verification_failed", "Transaction verification failed");
      }
    } catch (error) {
      if (this.record.state !== "failed") await this.fail("verification_failed", transactionMessage(error), error);
      throw error;
    }
  }

  async commit(): Promise<void> {
    this.expect("verifying");
    this.throwIfCancelled();

    if (this.approvalRequired) await this.verifyApprovedEvidence();

    // Atomic executors are expected to stage without changing the externally
    // visible artifact version, so a final baseline check remains meaningful.
    if (this.record.mode === "atomic") await this.checkConcurrency();

    try {
      await this.options.executor.commit?.(this.snapshot(), this.applyResult ?? {});
      await this.transition("committed");
    } catch (error) {
      await this.fail("commit_failed", transactionMessage(error), error);
      throw error;
    }
  }

  async rollback(): Promise<void> {
    if (this.record.state === "rolled_back") return;
    if (!this.options.executor.rollback) {
      await this.fail("rollback_failed", "Executor does not support rollback");
      throw new TransactionError("rollback_failed", "Executor does not support rollback");
    }
    await this.transition("rolling_back");
    try {
      const result = await this.options.executor.rollback(this.snapshot(), this.applyResult);
      await this.transition(result.complete ? "rolled_back" : "partially_applied", result);
    } catch (error) {
      await this.fail("rollback_failed", transactionMessage(error), error);
      throw error;
    }
  }

  async cancel(): Promise<void> {
    if (TERMINAL_STATES.has(this.record.state)) return;
    await this.transition("cancelled");
  }

  private async verifyApprovedEvidence(): Promise<void> {
    const approved = this.record.approvedEvidenceDigest;
    if (!approved) {
      const message = "Transaction approval evidence is unavailable";
      await this.fail("approval_evidence_missing", message);
      throw new TransactionError("approval_evidence_missing", message);
    }
    const current = await digestChangeSet(this.record.changeSet);
    if (current !== approved) {
      const message = `Transaction approval evidence mismatch: approved ${approved}, current ${current}`;
      await this.fail("approval_evidence_mismatch", message);
      throw new TransactionError("approval_evidence_mismatch", message);
    }
  }

  private async checkConcurrency(): Promise<void> {
    if (!this.options.artifacts) return;
    for (const artifact of this.record.changeSet.artifacts) {
      const expected = this.record.baselineVersions[artifactVersionKey(artifact)];
      if (expected === undefined) continue;
      const actual = await this.options.artifacts.providerFor(artifact).currentVersion(artifact);
      if (actual !== expected) {
        const message = `Artifact version conflict for ${artifact.id}: expected ${expected}, got ${actual ?? "<none>"}`;
        this.record.error = { code: "version_conflict", message };
        await this.transition("conflicted", { artifact: artifact.id, expected, actual });
        throw new TransactionError("version_conflict", message);
      }
    }
  }

  private throwIfCancelled(): void {
    if (this.record.context.signal?.aborted) {
      this.record.state = "cancelled";
      this.record.updatedAt = this.now();
      throw new TransactionError("cancelled", "Transaction was cancelled");
    }
  }

  private expect(...states: TransactionState[]): void {
    if (!states.includes(this.record.state)) {
      throw new TransactionError("invalid_state", `Expected transaction state ${states.join(" or ")}, got ${this.record.state}`);
    }
  }

  private async reject(code: TransactionFailureCode, message: string): Promise<void> {
    this.record.error = { code, message };
    await this.transition("rejected", this.record.error);
  }

  private async fail(code: TransactionFailureCode, message: string, cause?: unknown): Promise<void> {
    this.record.error = { code, message, cause };
    await this.transition("failed", this.record.error);
  }

  private async transition(state: TransactionState, data?: unknown): Promise<void> {
    this.record.state = state;
    this.record.updatedAt = this.now();
    const event: TransactionEvent = {
      type: `transaction.${state}`,
      transactionId: this.record.id,
      changeSetId: this.record.changeSet.id,
      sessionId: this.record.context.sessionId,
      correlationId: this.record.context.correlationId,
      artifactRefs: this.record.changeSet.artifacts.map((artifact) => artifact.id),
      time: this.record.updatedAt,
      state,
      data,
    };
    await this.options.onEvent?.(event, this.snapshot());
  }
}

function defaultId(): string {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
