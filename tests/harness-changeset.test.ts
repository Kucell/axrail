import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalService,
  CallbackApprovalProvider,
} from "../packages/approval/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";

function changeSet(id: string) {
  return {
    id,
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update" as const, target: "screen:overview" }],
  };
}

test("Harness executeChangeSet derives governed Adapter scope from executor provider", async () => {
  const harness = new HarnessRuntime({ environment: "engineering" });
  await harness.mountAdapter({
    id: "mock-hmi",
    version: "1.0.0",
    async capabilities() {
      return {
        adapterId: "mock-hmi",
        adapterVersion: "1.0.0",
        capabilities: {},
      };
    },
    policies() {
      return [
        {
          id: "allow-engineering",
          evaluate(input) {
            assert.equal(input.adapterId, "mock-hmi");
            assert.equal(input.environment, "engineering");
            return { effect: "allow" as const };
          },
        },
      ];
    },
  });

  let applied = false;
  let committed = false;
  const result = await harness.executeChangeSet(changeSet("cs-harness-success"), {
    executor: {
      id: "mock-hmi-executor",
      providerId: "mock-hmi",
      mode: "compensating",
      apply(transaction) {
        assert.deepEqual(transaction.context.adapterIds, ["mock-hmi"]);
        assert.equal(transaction.context.environment, "engineering");
        applied = true;
        return { externalRef: "mock:change:1" };
      },
      verify() {
        return applied;
      },
      commit() {
        committed = true;
      },
      rollback() {
        applied = false;
        return { complete: true };
      },
    },
    actor: { id: "engineer-1", type: "human" },
    sessionId: "session-1",
    correlationId: "work-order-1",
  });

  assert.equal(result.state, "committed");
  assert.equal(applied, true);
  assert.equal(committed, true);
  assert.deepEqual(result.context.adapterIds, ["mock-hmi"]);
  assert.equal(result.context.environment, "engineering");
});

test("Harness executeChangeSet fails before execution when executor provider Adapter is not mounted", async () => {
  const harness = new HarnessRuntime();
  let applied = false;

  await assert.rejects(
    harness.executeChangeSet(changeSet("cs-missing-adapter"), {
      executor: {
        id: "should-not-run",
        providerId: "missing-adapter",
        mode: "atomic",
        apply() {
          applied = true;
          return {};
        },
      },
      allowWithoutPolicy: true,
    }),
    /Mounted adapter not found: missing-adapter/,
  );

  assert.equal(applied, false);
});

test("Harness executeChangeSet rejects Artifact provider mismatch before governance or effect", async () => {
  const harness = new HarnessRuntime();
  await harness.mountAdapter({
    id: "provider-a",
    version: "1.0.0",
    async capabilities() {
      return {
        adapterId: "provider-a",
        adapterVersion: "1.0.0",
        capabilities: {},
      };
    },
  });

  let applied = false;
  await assert.rejects(
    harness.executeChangeSet(
      {
        id: "cs-provider-mismatch",
        protocolVersion: "0.1",
        artifacts: [{ id: "screen:overview", type: "hmi.screen", provider: "provider-b" }],
        operations: [{ op: "update", target: "screen:overview" }],
      },
      {
        executor: {
          id: "provider-a-executor",
          providerId: "provider-a",
          mode: "atomic",
          apply() {
            applied = true;
            return {};
          },
        },
        allowWithoutPolicy: true,
      },
    ),
    /ChangeSet artifact provider mismatch.*executor provider provider-a, artifact provider provider-b/,
  );

  assert.equal(applied, false);
});

test("Harness executeChangeSet preserves fail-closed Adapter policy", async () => {
  const harness = new HarnessRuntime();
  await harness.mountAdapter({
    id: "protected-hmi",
    version: "1.0.0",
    async capabilities() {
      return {
        adapterId: "protected-hmi",
        adapterVersion: "1.0.0",
        capabilities: {},
      };
    },
    policies() {
      return [
        {
          id: "deny-write",
          evaluate() {
            return { effect: "deny" as const, reason: "production mutation blocked" };
          },
        },
      ];
    },
  });

  let applied = false;
  const result = await harness.executeChangeSet(changeSet("cs-denied"), {
    executor: {
      id: "protected-executor",
      providerId: "protected-hmi",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  assert.equal(result.state, "rejected");
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(applied, false);
});

test("Harness executeChangeSet scopes Adapter validation and blocks invalid mutation before apply", async () => {
  const harness = new HarnessRuntime();
  await harness.mountAdapter({
    id: "validating-hmi",
    version: "1.0.0",
    async capabilities() {
      return {
        adapterId: "validating-hmi",
        adapterVersion: "1.0.0",
        capabilities: {},
      };
    },
    policies() {
      return [{ id: "allow", evaluate: () => ({ effect: "allow" as const }) }];
    },
    validators() {
      return [
        {
          id: "screen-validator",
          validate(_value, context) {
            assert.deepEqual(context.providerIds, ["validating-hmi"]);
            return [
              {
                code: "invalid_screen_change",
                message: "Screen mutation is invalid",
                severity: "error" as const,
              },
            ];
          },
        },
      ];
    },
  });

  let applied = false;
  const result = await harness.executeChangeSet(changeSet("cs-invalid"), {
    executor: {
      id: "validating-executor",
      providerId: "validating-hmi",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  assert.equal(result.state, "failed");
  assert.equal(result.error?.code, "validation_failed");
  assert.equal(result.validation?.valid, false);
  assert.equal(result.validation?.issues[0]?.code, "invalid_screen_change");
  assert.equal(applied, false);
});

test("Harness executeChangeSet binds required approval to ChangeSet evidence before commit", async () => {
  let approvalSeen = false;
  const approval = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => {
      approvalSeen = true;
      assert.equal(request.evidence?.changeSetId, "cs-approved");
      assert.ok(request.evidence?.changeSetDigest);
      assert.equal(request.evidenceDigest, request.evidence?.changeSetDigest);
      return {
        requestId: request.id,
        decision: "approved" as const,
        approver: { id: "reviewer-1", type: "human", roles: ["engineer"] },
        decidedAt: "2026-09-17T09:00:00.000Z",
        evidenceDigest: request.evidenceDigest,
      };
    }),
    now: () => "2026-09-17T09:00:00.000Z",
  });
  const harness = new HarnessRuntime({ approval });

  await harness.mountAdapter({
    id: "approval-hmi",
    version: "1.0.0",
    async capabilities() {
      return {
        adapterId: "approval-hmi",
        adapterVersion: "1.0.0",
        capabilities: {},
      };
    },
    policies() {
      return [
        {
          id: "approve-write",
          evaluate() {
            return { effect: "require-approval" as const, reason: "engineering review" };
          },
        },
      ];
    },
  });

  let applied = false;
  const result = await harness.executeChangeSet(changeSet("cs-approved"), {
    requiredApprovers: [{ role: "engineer", count: 1 }],
    executor: {
      id: "approval-executor",
      providerId: "approval-hmi",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
      verify() {
        return applied;
      },
    },
  });

  assert.equal(approvalSeen, true);
  assert.equal(result.state, "committed");
  assert.ok(result.approvedEvidenceDigest);
  assert.equal(applied, true);
});