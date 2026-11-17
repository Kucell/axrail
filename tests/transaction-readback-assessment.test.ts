import assert from "node:assert/strict";
import test from "node:test";

import { digestChangeSet } from "../packages/changesets/src/index.ts";
import {
  TransactionRuntime,
  assessUncertainTransaction,
  type TransactionReadbackEvidence,
} from "../packages/transactions/src/index.ts";

async function uncertainFixture() {
  let applies = 0;
  const runtime = new TransactionRuntime({
    effectFailureMode: "uncertain",
    allowWithoutPolicy: true,
    now: () => "2026-11-17T10:00:00.000Z",
    idFactory: () => "tx-readback",
    executor: {
      id: "hmi-executor",
      mode: "atomic",
      apply() {
        applies += 1;
        throw new Error("ACK lost after remote change");
      },
    },
  });
  const transaction = await runtime.execute({
    id: "changeset-readback",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update", target: "component:temperature", risk: { level: "L1" } }],
  }, { adapterIds: ["hmi-provider"] });
  assert.equal(transaction.state, "execution_uncertain");
  assert.equal(applies, 1);
  const digest = await digestChangeSet(transaction.changeSet);
  const evidence: TransactionReadbackEvidence = {
    transactionId: transaction.id,
    changeSetDigest: digest,
    providerId: "hmi-provider",
    observedAt: "2026-11-17T10:00:01.000Z",
    evidenceRef: "hmi://audit/revision-8",
    observation: "effect_present",
  };
  return { transaction, evidence, getAttempts: () => applies };
}

for (const [observation, expected] of [
  ["effect_present", "observed_applied"],
  ["effect_absent", "observed_absent"],
  ["unknown", "unresolved"],
] as const) {
  test(`readback captures ${observation} without granting retry or mutating transaction`, async () => {
    const { transaction, evidence, getAttempts } = await uncertainFixture();
    const result = await assessUncertainTransaction(transaction, {
      providerId: "hmi-provider",
      async readback() { return { ...evidence, observation }; },
    });
    assert.equal(result.outcome, expected);
    assert.equal(result.retrySafe, false);
    assert.equal(result.evidence?.transactionId, transaction.id);
    assert.equal(transaction.state, "execution_uncertain");
    assert.equal(getAttempts(), 1);
  });
}

for (const [caseName, changes] of [
  ["wrong transaction", { transactionId: "tx-other" }],
  ["wrong digest", { changeSetDigest: "sha256:wrong" }],
  ["wrong provider", { providerId: "other-hmi" }],
  ["missing reference", { evidenceRef: "" }],
  ["stale timestamp", { observedAt: "2026-11-17T09:59:00.000Z" }],
  ["invalid timestamp", { observedAt: "invalid" }],
] as const) {
  test(`readback refuses ${caseName} evidence`, async () => {
    const { transaction, evidence, getAttempts } = await uncertainFixture();
    const outcome = await assessUncertainTransaction(transaction, {
      providerId: "hmi-provider",
      async readback() { return { ...evidence, ...changes }; },
    });
    assert.equal(outcome.outcome, "unresolved");
    assert.equal(outcome.evidence, undefined);
    assert.equal(outcome.retrySafe, false);
    assert.equal(getAttempts(), 1);
  });
}

test("readback rejects unrelated provider before calling external Adapter", async () => {
  const { transaction } = await uncertainFixture();
  let called = false;
  const result = await assessUncertainTransaction(transaction, {
    providerId: "other-provider",
    async readback() {
      called = true;
      throw new Error("must not query");
    },
  });
  assert.equal(result.outcome, "unresolved");
  assert.equal(called, false);
});

test("readback fails closed when external Adapter is offline", async () => {
  const { transaction } = await uncertainFixture();
  const result = await assessUncertainTransaction(transaction, {
    providerId: "hmi-provider",
    async readback() { throw new Error("network timeout"); },
  });
  assert.equal(result.outcome, "unresolved");
  assert.equal(result.retrySafe, false);
});

test("readback only assesses execution_uncertain transactions", async () => {
  const { transaction, evidence } = await uncertainFixture();
  let called = false;
  const result = await assessUncertainTransaction(
    { ...transaction, state: "committed" },
    {
      providerId: "hmi-provider",
      async readback() { called = true; return evidence; },
    },
  );
  assert.equal(result.outcome, "unresolved");
  assert.equal(called, false);
});
