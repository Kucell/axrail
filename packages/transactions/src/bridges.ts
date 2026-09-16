import { ApprovalService, isApprovalGranted, type ApprovalRequirement } from "@axrail/approval";
import { digestChangeSet, highestDeclaredRisk, type ChangeSet } from "@axrail/changesets";
import {
  PolicyEngine,
  type PolicyDecision,
  type PolicyInput,
  type PolicyObligation,
} from "@axrail/policy";
import { ValidationPipeline } from "@axrail/validation";
import type {
  TransactionApprovalProvider,
  TransactionPolicyDecision,
  TransactionPolicyEvaluator,
  TransactionRecord,
} from "./types.js";

export type TransactionPolicyInputMapper = (
  transaction: TransactionRecord,
) => PolicyInput | readonly PolicyInput[];

export function createTransactionPolicyEvaluator(
  engine: PolicyEngine,
  mapInput: TransactionPolicyInputMapper = defaultPolicyInputs,
): TransactionPolicyEvaluator {
  return {
    async evaluate(transaction) {
      const mapped = mapInput(transaction);
      const inputs = Array.isArray(mapped) ? mapped : [mapped];
      const decisions: PolicyDecision[] = [];
      for (const input of inputs) {
        decisions.push(await engine.evaluate(input));
      }
      return mergeTransactionPolicyDecisions(decisions);
    },
  };
}

export interface TransactionApprovalBridgeOptions {
  readonly requiredApprovers?: readonly ApprovalRequirement[];
  readonly requestId?: (transaction: TransactionRecord) => string;
}

export function createTransactionApprovalProvider(
  service: ApprovalService,
  options: TransactionApprovalBridgeOptions = {},
): TransactionApprovalProvider {
  return {
    async approve(transaction) {
      const artifactVersions: Record<string, string> = {};
      for (const [key, value] of Object.entries(transaction.baselineVersions)) {
        if (value !== undefined) artifactVersions[key] = value;
      }

      const changeSetDigest = await digestChangeSet(transaction.changeSet);
      const request = {
        id: options.requestId?.(transaction) ?? `approval:${transaction.id}`,
        transactionId: transaction.id,
        actor: transaction.context.actor
          ? {
              id: transaction.context.actor.id,
              type: transaction.context.actor.type,
              displayName: transaction.context.actor.displayName,
            }
          : undefined,
        operation: {
          action: "transaction.execute",
          target: transaction.changeSet.artifacts.map((artifact) => artifact.id).join(", "),
          description: transaction.changeSet.reason,
        },
        risk: highestDeclaredRisk(transaction.changeSet) ?? "L5",
        reason: transaction.changeSet.reason ?? "Approve Axrail engineering transaction",
        requiredApprovers: options.requiredApprovers,
        evidence: {
          changeSetId: transaction.changeSet.id,
          changeSetDigest,
          artifactVersions,
          validationSummary: transaction.validation
            ? {
                valid: transaction.validation.valid,
                validatorsRun: transaction.validation.validatorsRun,
                issueCount: transaction.validation.issues.length,
              }
            : undefined,
          metadata: {
            environment: transaction.context.environment,
            adapterIds: transaction.context.adapterIds,
            transactionMode: transaction.mode,
          },
        },
        evidenceDigest: changeSetDigest,
      } as const;

      const decision = await service.request(request);
      return {
        approved: isApprovalGranted(request, decision),
        evidenceDigest: decision.evidenceDigest,
      };
    },
  };
}

export function createTransactionValidator(
  pipeline: ValidationPipeline<ChangeSet>,
) {
  return (changeSet: ChangeSet, transaction: TransactionRecord) =>
    pipeline.validate(changeSet, {
      environment: transaction.context.environment,
      providerIds: transaction.context.adapterIds,
      signal: transaction.context.signal,
      metadata: {
        transactionId: transaction.id,
        mode: transaction.mode,
      },
    });
}

function defaultPolicyInputs(transaction: TransactionRecord): readonly PolicyInput[] {
  const base = defaultPolicyInput(transaction);
  const adapterIds = [...new Set(transaction.context.adapterIds ?? [])];
  if (adapterIds.length === 0) return [base];
  return adapterIds.map((adapterId) => ({ ...base, adapterId }));
}

function defaultPolicyInput(transaction: TransactionRecord): PolicyInput {
  const artifact = transaction.changeSet.artifacts.length === 1
    ? transaction.changeSet.artifacts[0]
    : undefined;

  return {
    action: "transaction.execute",
    actor: transaction.context.actor
      ? {
          id: transaction.context.actor.id,
          type: transaction.context.actor.type,
        }
      : undefined,
    risk: highestDeclaredRisk(transaction.changeSet),
    environment: transaction.context.environment,
    transactionMode: transaction.mode,
    resource: artifact
      ? {
          id: artifact.id,
          type: artifact.type,
          version: artifact.version,
          provider: artifact.provider,
        }
      : undefined,
    facts: {
      changeSetId: transaction.changeSet.id,
      operationCount: transaction.changeSet.operations.length,
      artifactCount: transaction.changeSet.artifacts.length,
      adapterIds: transaction.context.adapterIds,
    },
  };
}

function mergeTransactionPolicyDecisions(
  decisions: readonly PolicyDecision[],
): TransactionPolicyDecision {
  const deny = decisions.find((decision) => decision.effect === "deny");
  const requiresApproval = decisions.some(
    (decision) => decision.effect === "require-approval",
  );
  const effect: TransactionPolicyDecision["effect"] = deny
    ? "deny"
    : requiresApproval
      ? "require_approval"
      : "allow";

  const reason = deny?.reason ?? decisions.find((decision) => decision.reason)?.reason;
  const obligations = dedupeObligations(
    decisions.flatMap((decision) => decision.obligations ?? []),
  );

  return {
    effect,
    reason,
    obligations,
  };
}

function dedupeObligations(
  obligations: readonly PolicyObligation[],
): readonly PolicyObligation[] {
  const unique = new Map<string, PolicyObligation>();
  for (const obligation of obligations) {
    unique.set(JSON.stringify(obligation), obligation);
  }
  return [...unique.values()];
}
