import { ApprovalService, isApprovalGranted, type ApprovalRequirement } from "@axrail/approval";
import { digestChangeSet, highestDeclaredRisk, type ChangeSet } from "@axrail/changesets";
import { PolicyEngine, type PolicyInput } from "@axrail/policy";
import { ValidationPipeline } from "@axrail/validation";
import type {
  TransactionApprovalProvider,
  TransactionPolicyEvaluator,
  TransactionRecord,
} from "./types.js";

export function createTransactionPolicyEvaluator(
  engine: PolicyEngine,
  mapInput: (transaction: TransactionRecord) => PolicyInput = defaultPolicyInput,
): TransactionPolicyEvaluator {
  return {
    async evaluate(transaction) {
      const decision = await engine.evaluate(mapInput(transaction));
      return {
        effect:
          decision.effect === "require-approval"
            ? "require_approval"
            : decision.effect,
        reason: decision.reason,
      };
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
      return isApprovalGranted(request, decision);
    },
  };
}

export function createTransactionValidator(
  pipeline: ValidationPipeline<ChangeSet>,
) {
  return (changeSet: ChangeSet, transaction: TransactionRecord) =>
    pipeline.validate(changeSet, {
      environment: transaction.context.environment,
      signal: transaction.context.signal,
      metadata: {
        transactionId: transaction.id,
        mode: transaction.mode,
      },
    });
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
    adapterId: transaction.context.adapterIds?.[0],
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
    },
  };
}
