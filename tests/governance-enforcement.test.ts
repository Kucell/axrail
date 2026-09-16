import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalError,
  ApprovalService,
  CallbackApprovalProvider,
} from "../packages/approval/src/index.ts";
import { digestChangeSet } from "../packages/changesets/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";
import { ToolRuntime } from "../packages/tools/src/index.ts";
import { TransactionRuntime } from "../packages/transactions/src/index.ts";

test("ApprovalService rejects an approved decision that misses required roles", async () => {
  const approval = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => ({
      requestId: request.id,
      decision: "approved",
      approver: {
        id: "operator-1",
        type: "human",
        roles: ["operator"],
      },
      decidedAt: "2026-09-16T09:00:00.000Z",
    })),
  });

  await assert.rejects(
    () =>
      approval.request({
        id: "approval-role",
        operation: { action: "transaction.execute" },
        risk: "L3",
        reason: "Production deployment",
        requiredApprovers: [{ role: "controls-engineer", count: 1 }],
      }),
    (error: unknown) =>
      error instanceof ApprovalError && error.code === "requirements_unsatisfied",
  );
});

test("ApprovalService accepts aggregated distinct principals that satisfy quorum", async () => {
  const approval = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => ({
      requestId: request.id,
      decision: "approved",
      approvers: [
        {
          id: "engineer-1",
          type: "human",
          roles: ["controls-engineer"],
        },
        {
          id: "owner-1",
          type: "human",
          roles: ["production-owner"],
        },
      ],
      decidedAt: "2026-09-16T09:00:00.000Z",
    })),
  });

  const decision = await approval.request({
    id: "approval-quorum",
    operation: { action: "deploy" },
    risk: "L3",
    reason: "Deploy engineering project",
    requiredApprovers: [
      { role: "controls-engineer", count: 1 },
      { role: "production-owner", count: 1 },
    ],
  });

  assert.equal(decision.decision, "approved");
});

test("ToolRuntime forces approval for L4 even when policy allows", async () => {
  let executed = false;
  const runtime = new ToolRuntime({
    policy: {
      evaluate() {
        return { allow: true };
      },
    },
  });
  runtime.registry.register({
    name: "robot.runtime.start",
    description: "Start robot runtime",
    risk: "L4",
    effect: "physical-action",
    execute() {
      executed = true;
    },
  });

  const result = await runtime.execute({
    id: "call-l4",
    name: "robot.runtime.start",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "approval_unavailable");
  assert.equal(executed, false);
});

test("ToolRuntime fails closed on unsupported policy obligation", async () => {
  let executed = false;
  const runtime = new ToolRuntime({
    policy: {
      evaluate() {
        return {
          allow: true,
          obligations: [{ type: "require-dry-run" }],
        };
      },
    },
  });
  runtime.registry.register({
    name: "engineering.modify",
    description: "Modify engineering data",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      executed = true;
    },
  });

  const result = await runtime.execute({
    id: "call-obligation",
    name: "engineering.modify",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_obligation_unsatisfied");
  assert.equal(executed, false);
});

test("Harness propagates adapter policy obligations into ToolRuntime enforcement", async () => {
  const harness = new HarnessRuntime({ environment: "design" });
  let executed = false;

  await harness.mountAdapter({
    id: "obligation-adapter",
    version: "0.1.0",
    async capabilities() {
      return {
        adapterId: "obligation-adapter",
        adapterVersion: "0.1.0",
        capabilities: { "engineering.modify": { level: "exact" as const } },
      };
    },
    tools() {
      return [
        {
          name: "engineering.modify",
          description: "Modify engineering data",
          risk: "L2" as const,
          effect: "engineering-write" as const,
          execute() {
            executed = true;
          },
        },
      ];
    },
    policies() {
      return [
        {
          id: "transaction-required",
          evaluate(input) {
            return input.action === "engineering.modify"
              ? {
                  effect: "allow" as const,
                  obligations: [{ type: "require-transaction" }],
                }
              : undefined;
          },
        },
      ];
    },
  });

  const result = await harness.tools.execute({
    id: "call-harness-obligation",
    name: "engineering.modify",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_obligation_unsatisfied");
  assert.equal(executed, false);
});

test("TransactionRuntime does not let allowWithoutPolicy bypass L4 policy floor", async () => {
  let applied = false;
  const runtime = new TransactionRuntime({
    allowWithoutPolicy: true,
    executor: {
      id: "l4-no-policy",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  const result = await runtime.execute({
    id: "cs-l4-no-policy",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [
      {
        op: "invoke",
        target: "robot:start",
        risk: { level: "L4" },
      },
    ],
  });

  assert.equal(result.state, "rejected");
  assert.equal(result.error?.code, "policy_unavailable");
  assert.equal(applied, false);
});

test("TransactionRuntime forces approval for L4 after policy allow", async () => {
  let approvals = 0;
  let applied = false;
  const runtime = new TransactionRuntime({
    policy: {
      evaluate() {
        return { effect: "allow" };
      },
    },
    approval: {
      async approve(transaction) {
        approvals += 1;
        return {
          approved: true,
          evidenceDigest: await digestChangeSet(transaction.changeSet),
        };
      },
    },
    executor: {
      id: "l4-approved",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  const result = await runtime.execute({
    id: "cs-l4-approved",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [
      {
        op: "invoke",
        target: "robot:start",
        risk: { level: "L4" },
      },
    ],
  });

  assert.equal(result.state, "committed");
  assert.equal(approvals, 1);
  assert.equal(applied, true);
});

test("TransactionRuntime fails closed on unsupported policy obligation", async () => {
  let applied = false;
  const runtime = new TransactionRuntime({
    policy: {
      evaluate() {
        return {
          effect: "allow",
          obligations: [{ type: "require-two-person-approval" }],
        };
      },
    },
    executor: {
      id: "unsupported-obligation",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  const result = await runtime.execute({
    id: "cs-obligation",
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

  assert.equal(result.state, "rejected");
  assert.equal(result.error?.code, "policy_obligation_unsatisfied");
  assert.equal(applied, false);
});
