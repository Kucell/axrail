import { digestChangeSet } from "@axrail/changesets";
import type { TransactionRecord } from "./types.js";

/** Domain Adapter read-back evidence; this is not a new execution authority. */
export interface TransactionReadbackEvidence {
  readonly transactionId: string;
  readonly changeSetDigest: string;
  readonly providerId: string;
  readonly observedAt: string;
  /** Positive observations must be based on target-system state, not an ACK alone. */
  readonly observation: "effect_present" | "effect_absent" | "unknown";
  readonly evidenceRef: string;
}

export interface TransactionReadbackProvider {
  /** Authenticated by the application; must perform observation only. */
  readonly providerId: string;
  readback(transaction: TransactionRecord): Promise<TransactionReadbackEvidence>;
}

export interface TransactionReadbackAssessment {
  /** Observation is advisory until a separately governed recovery decision. */
  readonly outcome: "observed_applied" | "observed_absent" | "unresolved";
  readonly transactionId: string;
  readonly evidence?: TransactionReadbackEvidence;
  readonly reason: string;
  /** Always false: read-back alone never licenses automatic replay. */
  readonly retrySafe: false;
}

/**
 * Read-only assessment for an uncertain transaction. Does not update the
 * transaction state, apply, commit, rollback, or retry. Caller must configure
 * an authenticated and trustworthy Adapter; self-asserted observations are not
 * physical proof or authorization.
 */
export async function assessUncertainTransaction(
  transaction: TransactionRecord,
  provider: TransactionReadbackProvider,
): Promise<TransactionReadbackAssessment> {
  const unresolved = (reason: string): TransactionReadbackAssessment => ({
    outcome: "unresolved",
    transactionId: transaction.id,
    reason,
    retrySafe: false,
  });
  if (transaction.state !== "execution_uncertain") {
    return unresolved("Transaction is not in execution_uncertain state");
  }
  if (!transaction.context.adapterIds?.includes(provider.providerId)) {
    return unresolved("Read-back provider is not bound to this transaction");
  }

  let evidence: TransactionReadbackEvidence;
  try {
    evidence = await provider.readback(transaction);
  } catch {
    return unresolved("Read-back unavailable; original execution outcome remains uncertain");
  }

  const digest = await digestChangeSet(transaction.changeSet);
  if (
    evidence.transactionId !== transaction.id ||
    evidence.changeSetDigest !== digest ||
    evidence.providerId !== provider.providerId ||
    !evidence.evidenceRef?.trim()
  ) {
    return unresolved("Read-back evidence identity, digest or reference mismatch");
  }

  const observedAt = Date.parse(evidence.observedAt);
  const lastTransition = Date.parse(transaction.updatedAt);
  if (
    !Number.isFinite(observedAt) ||
    !Number.isFinite(lastTransition) ||
    observedAt < lastTransition
  ) {
    return unresolved("Read-back evidence is invalid or older than the uncertain transition");
  }

  const outcome = evidence.observation === "effect_present"
    ? "observed_applied"
    : evidence.observation === "effect_absent"
      ? "observed_absent"
      : "unresolved";
  return {
    outcome,
    transactionId: transaction.id,
    evidence,
    reason: outcome === "unresolved"
      ? "Read-back did not establish the effect outcome"
      : "Bound Adapter observation recorded; separate governance is required for recovery",
    retrySafe: false,
  };
}
