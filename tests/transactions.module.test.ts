import assert from "node:assert/strict";
import test from "node:test";

import { ApprovalService, CallbackApprovalProvider } from "../packages/approval/src/index.ts";
import { ArtifactProviderRegistry } from "../packages/artifacts/src/index.ts";
import { digestChangeSet, type ChangeSet } from "../packages/changesets/src/index.ts";
import { PolicyEngine } from "../packages/policy/src/index.ts";
import {
  TransactionError,
  TransactionRuntime,
  createTransactionApprovalProvider,
  createTransactionPolicyEvaluator,
  createTransactionValidator,
  type TransactionExecutor,
  type TransactionRecord,
} from "../packages/transactions/src/index.ts";
import { ValidationPipeline } from "../packages/validation/src/index.ts";

function cs(
  id: string,
  risk: "L0" | "L1" | "L2" | "L3" | "L4" | "L5" = "L2",
  artifacts: ChangeSet["artifacts"] = [],
): ChangeSet {
  return {
    id,
    protocolVersion: "0.1",
    artifacts,
    operations: [{ id: "op", op: "update", target: "target", risk: { level: risk } }],
  };
}

function executor(overrides: Partial<TransactionExecutor> = {}): TransactionExecutor {
  return {
    id: "executor",
    mode: "atomic",
    apply: () => ({}),
    ...overrides,
  };
}

test("TransactionRuntime covers no-policy default validation and generated ids", async () => {
  const runtime = new TransactionRuntime({ executor: executor(), allowWithoutPolicy: true });
  const result = await runtime.execute(cs("allowed", "L1"));
  assert.equal(result.state, "committed");
  assert.match(result.id, /^tx_/);
  assert.equal(result.validation?.valid, true);
  assert.deepEqual(result.validation?.validatorsRun, []);

  const rejected = await new TransactionRuntime({ executor: executor() }).execute(cs("no-policy", "L2"));
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.error?.code, "policy_unavailable");
  assert.equal(rejected.error?.message, "No transaction policy evaluator is configured");
});

test("Transaction prepare covers expected, declared and provider versions plus prepare failures", async () => {
  const artifacts = new ArtifactProviderRegistry();
  artifacts.register({
    id: "p",
    async get(ref) { return { ...ref, provider: "p", version: "provider-version" }; },
    async exists() { return true; },
    async currentVersion() { return "provider-version"; },
  });
  const changeSet = cs("versions", "L1", [
    { id: "expected", type: "x", provider: "p" },
    { id: "declared", type: "x", provider: "p", version: "declared-version" },
    { id: "provider", type: "x", provider: "p" },
  ]);
  const runtime = new TransactionRuntime({ executor: executor(), artifacts, allowWithoutPolicy: true });
  const tx = runtime.begin(changeSet, { expectedVersions: { "p:expected": "expected-version" } });
  await tx.prepare();
  assert.deepEqual(tx.snapshot().baselineVersions, {
    "p:expected": "expected-version",
    "p:declared": "declared-version",
    "p:provider": "provider-version",
  });

  const failing = new TransactionRuntime({
    executor: executor({ prepare() { throw "prepare failed"; } }),
    allowWithoutPolicy: true,
  });
  const failed = await failing.execute(cs("prepare-fail", "L1"));
  assert.equal(failed.state, "failed");
  assert.equal(failed.error?.code, "artifact_unavailable");
  assert.equal(failed.error?.message, "prepare failed");
});

test("Transaction policy covers deny defaults, obligations and high-risk floor", async () => {
  let runtime = new TransactionRuntime({
    executor: executor(),
    policy: { evaluate: () => ({ effect: "deny" }) },
  });
  let result = await runtime.execute(cs("denied"));
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(result.error?.message, "Transaction denied by policy");

  runtime = new TransactionRuntime({
    executor: executor(),
    policy: { evaluate: () => ({ effect: "allow", obligations: [{ type: "require-environment", parameters: { value: "prod" } }] }) },
  });
  result = await runtime.execute(cs("wrong-env"), { environment: "dev" });
  assert.equal(result.error?.code, "policy_obligation_unsatisfied");
  assert.match(result.error?.message ?? "", /expected prod/);

  runtime = new TransactionRuntime({
    executor: executor(),
    policy: { evaluate: () => ({ effect: "allow", obligations: [{ type: "require-environment", parameters: {} }] }) },
  });
  result = await runtime.execute(cs("invalid-obligation"), { environment: "prod" });
  assert.equal(result.error?.code, "policy_obligation_unsatisfied");

  runtime = new TransactionRuntime({
    executor: executor(),
    policy: { evaluate: () => ({ effect: "allow", obligations: [{ type: "require-transaction" }] }) },
  });
  result = await runtime.execute(cs("transaction-obligation"));
  assert.equal(result.state, "committed");

  result = await new TransactionRuntime({ executor: executor(), allowWithoutPolicy: true }).execute(cs("l5", "L5"));
  assert.equal(result.error?.code, "policy_unavailable");
  assert.match(result.error?.message ?? "", /required for L5/);
});

test("Transaction validation failure stops before execution", async () => {
  let applied = false;
  const result = await new TransactionRuntime({
    executor: executor({ apply() { applied = true; return {}; } }),
    allowWithoutPolicy: true,
    validate: async () => ({
      valid: false,
      validatorsRun: ["v"],
      issues: [{ code: "bad", message: "bad", severity: "error" }],
    }),
  }).execute(cs("invalid", "L1"));
  assert.equal(result.state, "failed");
  assert.equal(result.error?.code, "validation_failed");
  assert.equal(applied, false);
});

test("Transaction approval covers unavailable, denied, missing evidence and success", async () => {
  const policy = { evaluate: () => ({ effect: "require_approval" as const }) };

  let result = await new TransactionRuntime({ executor: executor(), policy }).execute(cs("unavailable"));
  assert.equal(result.error?.code, "approval_unavailable");

  result = await new TransactionRuntime({
    executor: executor(),
    policy,
    approval: { approve: () => ({ approved: false }) },
  }).execute(cs("denied"));
  assert.equal(result.state, "rejected");
  assert.equal(result.error?.code, "approval_denied");

  result = await new TransactionRuntime({
    executor: executor(),
    policy,
    approval: { approve: () => ({ approved: true }) },
  }).execute(cs("missing-digest"));
  assert.equal(result.error?.code, "approval_evidence_missing");

  const changeSet = cs("approved");
  result = await new TransactionRuntime({
    executor: executor(),
    policy,
    approval: {
      async approve(transaction) {
        return { approved: true, evidenceDigest: await digestChangeSet(transaction.changeSet) };
      },
    },
  }).execute(changeSet);
  assert.equal(result.state, "committed");
  assert.ok(result.approvedEvidenceDigest);
});

test("Transaction apply, verify and commit failures record distinct truth", async () => {
  let result = await new TransactionRuntime({
    executor: executor({ apply() { throw "apply failed"; } }),
    allowWithoutPolicy: true,
  }).execute(cs("apply", "L1"));
  assert.equal(result.error?.code, "execution_failed");
  assert.equal(result.error?.message, "apply failed");

  result = await new TransactionRuntime({
    executor: executor({ verify: () => false }),
    allowWithoutPolicy: true,
  }).execute(cs("verify-false", "L1"));
  assert.equal(result.error?.code, "verification_failed");
  assert.equal(result.error?.message, "Transaction verification failed");

  result = await new TransactionRuntime({
    executor: executor({ verify() { throw "verify failed"; } }),
    allowWithoutPolicy: true,
  }).execute(cs("verify-error", "L1"));
  assert.equal(result.error?.code, "verification_failed");
  assert.equal(result.error?.message, "verify failed");

  result = await new TransactionRuntime({
    executor: executor({ commit() { throw "commit failed"; } }),
    allowWithoutPolicy: true,
  }).execute(cs("commit", "L1"));
  assert.equal(result.error?.code, "commit_failed");
  assert.equal(result.error?.message, "commit failed");
});

test("Transaction rollback covers unsupported, complete, partial, repeated and failure paths", async () => {
  const unsupported = new TransactionRuntime({ executor: executor(), allowWithoutPolicy: true }).begin(cs("unsupported", "L1"));
  await assert.rejects(unsupported.rollback(), (error: unknown) => (error as TransactionError).code === "rollback_failed");
  assert.equal(unsupported.snapshot().error?.code, "rollback_failed");

  const complete = new TransactionRuntime({
    executor: executor({ rollback: () => ({ complete: true }) }),
    allowWithoutPolicy: true,
  }).begin(cs("complete", "L1"));
  await complete.rollback();
  assert.equal(complete.state, "rolled_back");
  await complete.rollback();
  assert.equal(complete.state, "rolled_back");

  const partial = new TransactionRuntime({
    executor: executor({ rollback: () => ({ complete: false, metadata: { remaining: 1 } }) }),
    allowWithoutPolicy: true,
  }).begin(cs("partial", "L1"));
  await partial.rollback();
  assert.equal(partial.state, "partially_applied");

  const failed = new TransactionRuntime({
    executor: executor({ rollback() { throw "rollback failed"; } }),
    allowWithoutPolicy: true,
  }).begin(cs("rollback-error", "L1"));
  await assert.rejects(failed.rollback(), /rollback failed/);
  assert.equal(failed.snapshot().error?.code, "rollback_failed");
});

test("Transaction handles invalid states, cancellation and terminal cancel idempotence", async () => {
  const tx = new TransactionRuntime({ executor: executor(), allowWithoutPolicy: true }).begin(cs("states", "L1"));
  await assert.rejects(tx.commit(), (error: unknown) => (error as TransactionError).code === "invalid_state");
  await tx.cancel();
  assert.equal(tx.state, "cancelled");
  await tx.cancel();
  assert.equal(tx.state, "cancelled");

  const controller = new AbortController();
  const cancelled = new TransactionRuntime({ executor: executor(), allowWithoutPolicy: true }).begin(
    cs("abort", "L1"),
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(cancelled.prepare(), (error: unknown) => (error as TransactionError).code === "cancelled");
  assert.equal(cancelled.state, "cancelled");
});

test("Transaction concurrency covers missing actual versions and compensating commit path", async () => {
  let current: string | undefined;
  const artifacts = new ArtifactProviderRegistry();
  artifacts.register({
    id: "p",
    async get(ref) { return { ...ref, provider: "p", version: current }; },
    async exists() { return true; },
    async currentVersion() { return current; },
  });
  const changeSet = cs("conflict", "L1", [{ id: "a", type: "x", provider: "p", version: "1" }]);
  const result = await new TransactionRuntime({ executor: executor(), artifacts, allowWithoutPolicy: true }).execute(changeSet);
  assert.equal(result.state, "conflicted");
  assert.match(result.error?.message ?? "", /got <none>/);

  current = "1";
  const compensating = await new TransactionRuntime({
    executor: executor({ mode: "compensating", apply() { current = "2"; return {}; } }),
    artifacts,
    allowWithoutPolicy: true,
  }).execute(changeSet);
  assert.equal(compensating.state, "committed");
});

test("Transaction bridges map policy, validation and approval evidence across context variants", async () => {
  const engine = new PolicyEngine({ defaultEffect: "allow" });
  const seen: unknown[] = [];
  engine.register({ id: "capture", evaluate(input) { seen.push(input); return { effect: "allow", obligations: [{ type: "audit" }] }; } });
  const evaluator = createTransactionPolicyEvaluator(engine);

  const baseRecord: TransactionRecord = {
    id: "tx",
    changeSet: {
      ...cs("bridge"),
      reason: "reason",
      actor: { id: "actor", type: "human", displayName: "Actor" },
      artifacts: [{ id: "artifact", type: "project", provider: "p", version: "1" }],
    },
    state: "prepared",
    mode: "atomic",
    createdAt: "t",
    updatedAt: "t",
    context: { environment: "design", adapterIds: ["a", "a", "b"], actor: { id: "ctx", type: "human" } },
    baselineVersions: { "p:artifact": "1", skipped: undefined },
    validation: { valid: true, issues: [], validatorsRun: ["v"] },
  };
  const policy = await evaluator.evaluate(baseRecord);
  assert.equal(policy.effect, "allow");
  assert.deepEqual(policy.obligations, [{ type: "audit" }]);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((input: any) => input.adapterId), ["a", "b"]);
  assert.equal((seen[0] as any).resource.id, "artifact");
  assert.equal((seen[0] as any).actor.id, "ctx");

  const mapped = createTransactionPolicyEvaluator(engine, () => ({ action: "custom" }));
  assert.equal((await mapped.evaluate({ ...baseRecord, context: {}, changeSet: { ...baseRecord.changeSet, artifacts: [] } })).effect, "allow");

  let approvalRequest: any;
  const approvalService = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => {
      approvalRequest = request;
      return {
        requestId: request.id,
        decision: "approved",
        decidedAt: new Date().toISOString(),
        evidenceDigest: request.evidenceDigest,
      };
    }),
  });
  const approval = createTransactionApprovalProvider(approvalService, {
    requestId: () => "custom-approval",
  });
  const approvalResult = await approval.approve(baseRecord);
  assert.equal(approvalResult.approved, true);
  assert.equal(approvalRequest.id, "custom-approval");
  assert.equal(approvalRequest.evidence.artifactVersions["p:artifact"], "1");
  assert.equal("skipped" in approvalRequest.evidence.artifactVersions, false);
  assert.equal(approvalRequest.evidence.validationSummary.valid, true);
  assert.equal(approvalRequest.operation.description, "reason");

  const noMetadataRecord = {
    ...baseRecord,
    changeSet: { ...cs("fallback", "L0"), artifacts: [] },
    context: {},
    baselineVersions: {},
    validation: undefined,
  } satisfies TransactionRecord;
  let fallbackRequest: any;
  const fallbackApproval = createTransactionApprovalProvider(new ApprovalService({
    provider: new CallbackApprovalProvider((request) => {
      fallbackRequest = request;
      return { requestId: request.id, decision: "rejected", decidedAt: new Date().toISOString() };
    }),
  }));
  assert.equal((await fallbackApproval.approve(noMetadataRecord)).approved, false);
  assert.match(fallbackRequest.id, /^approval:tx$/);
  assert.equal(fallbackRequest.evidence.validationSummary, undefined);

  const validation = new ValidationPipeline<ChangeSet>();
  let validationContext: any;
  validation.register({ id: "capture", validate(_value, context) { validationContext = context; return []; } });
  const validate = createTransactionValidator(validation);
  const validationResult = await validate(baseRecord.changeSet, baseRecord);
  assert.equal(validationResult.valid, true);
  assert.equal(validationContext.environment, "design");
  assert.deepEqual(validationContext.providerIds, ["a", "a", "b"]);
  assert.equal(validationContext.metadata.transactionId, "tx");
});
