import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalError,
  ApprovalService,
  CallbackApprovalProvider,
} from "../packages/approval/src/index.ts";
import {
  digestChangeSet,
  type ChangeSet,
} from "../packages/changesets/src/index.ts";
import {
  TransactionRuntime,
  createTransactionApprovalProvider,
} from "../packages/transactions/src/index.ts";

test("ChangeSet digest is stable across object key insertion order", async () => {
  const left: ChangeSet = {
    id: "cs-stable",
    protocolVersion: "0.1",
    artifacts: [],
    metadata: { z: 2, a: { second: 2, first: 1 } },
    operations: [
      {
        op: "update",
        target: "screen:overview",
        value: { width: 100, height: 50 },
      },
    ],
  };
  const right: ChangeSet = {
    protocolVersion: "0.1",
    id: "cs-stable",
    operations: [
      {
        target: "screen:overview",
        op: "update",
        value: { height: 50, width: 100 },
      },
    ],
    metadata: { a: { first: 1, second: 2 }, z: 2 },
    artifacts: [],
  };

  assert.equal(await digestChangeSet(left), await digestChangeSet(right));
});

test("ChangeSet digest changes when material operation data changes", async () => {
  const first: ChangeSet = {
    id: "cs-change",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update", target: "motor:1", value: { speed: 100 } }],
  };
  const second: ChangeSet = {
    ...first,
    operations: [{ op: "update", target: "motor:1", value: { speed: 101 } }],
  };

  assert.notEqual(await digestChangeSet(first), await digestChangeSet(second));
});

test("ApprovalService fails closed when approved evidence digest does not match", async () => {
  const approval = new ApprovalService({
    provider: {
      async requestApproval(request) {
        return {
          requestId: request.id,
          decision: "approved",
          decidedAt: "2026-09-16T09:00:00.000Z",
          evidenceDigest: "sha256:stale",
        };
      },
    },
  });

  await assert.rejects(
    () =>
      approval.request({
        id: "approval-current",
        operation: { action: "transaction.execute" },
        risk: "L2",
        reason: "Approve current change",
        evidenceDigest: "sha256:current",
      }),
    (error: unknown) =>
      error instanceof ApprovalError && error.code === "evidence_mismatch",
  );
});

test("Transaction approval bridge binds approval to current ChangeSet digest", async () => {
  let observedDigest: string | undefined;
  const approval = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => {
      observedDigest = request.evidenceDigest;
      return {
        requestId: request.id,
        decision: "approved",
        decidedAt: "2026-09-16T09:00:00.000Z",
      };
    }),
  });

  const runtime = new TransactionRuntime({
    policy: {
      evaluate() {
        return { effect: "require_approval" };
      },
    },
    approval: createTransactionApprovalProvider(approval),
    executor: {
      id: "digest-executor",
      mode: "atomic",
      apply() {
        return {};
      },
    },
  });

  const result = await runtime.execute({
    id: "cs-approved",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [
      {
        op: "update",
        target: "hmi:screen",
        risk: { level: "L2" },
      },
    ],
  });

  assert.equal(result.state, "committed");
  assert.match(observedDigest ?? "", /^sha256:[0-9a-f]{64}$/);
});
