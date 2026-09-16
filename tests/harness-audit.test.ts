import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalService,
  CallbackApprovalProvider,
} from "../packages/approval/src/index.ts";
import { collectEvents } from "../packages/events/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";

test("HarnessRuntime correlates agent, policy, approval, tool and transaction events", async () => {
  const approval = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => ({
      requestId: request.id,
      decision: "approved",
      approver: { id: "engineer", type: "human" },
      decidedAt: "2026-09-16T08:30:00.000Z",
    })),
  });

  let id = 0;
  const harness = new HarnessRuntime({
    approval,
    environment: "design",
    idFactory: (prefix) => `${prefix}-${++id}`,
    now: (() => {
      let seconds = 0;
      return () => `2026-09-16T08:30:${String(seconds++).padStart(2, "0")}.000Z`;
    })(),
  });

  await harness.mountAdapter({
    id: "audit-hmi",
    version: "0.1.0",
    async capabilities() {
      return {
        adapterId: "audit-hmi",
        adapterVersion: "0.1.0",
        capabilities: { "hmi.screen.create": { level: "exact" } },
      };
    },
    policies() {
      return [
        {
          id: "audit-policy",
          evaluate(input) {
            if (input.action === "hmi.screen.create") {
              return { effect: "require-approval", reason: "L2 tool requires approval" };
            }
            if (input.action === "transaction.execute") {
              return { effect: "allow" };
            }
            return undefined;
          },
        },
      ];
    },
    tools() {
      return [
        {
          name: "hmi.screen.create",
          description: "Create a mock HMI screen through a governed transaction",
          risk: "L2",
          effect: "engineering-write",
          async execute(input, context) {
            const name =
              input && typeof input === "object" && typeof (input as { name?: unknown }).name === "string"
                ? (input as { name: string }).name
                : "Overview";

            let committed = false;
            const transactions = harness.createTransactionRuntime({
              executor: {
                id: "audit-hmi-executor",
                mode: "atomic",
                apply() {
                  return { metadata: { name } };
                },
                verify() {
                  return true;
                },
                commit() {
                  committed = true;
                },
              },
            });

            const result = await transactions.execute(
              {
                id: `changeset-${name}`,
                protocolVersion: "0.1",
                artifacts: [],
                reason: `Create ${name}`,
                operations: [
                  {
                    op: "create",
                    target: "screen",
                    value: { name },
                    risk: { level: "L2" },
                  },
                ],
              },
              {
                actor: context.actorId ? { id: context.actorId, type: "user" } : undefined,
                environment: "design",
                adapterIds: ["audit-hmi"],
                sessionId: context.sessionId,
                correlationId:
                  typeof context.metadata?.correlationId === "string"
                    ? context.metadata.correlationId
                    : undefined,
              },
            );

            assert.equal(result.state, "committed");
            assert.equal(committed, true);
            return { name, transactionId: result.id };
          },
        },
      ];
    },
  });

  let modelRound = 0;
  const agent = harness.createAgent({
    model: {
      id: "audit-model",
      async complete() {
        modelRound += 1;
        if (modelRound === 1) {
          return {
            toolCalls: [
              {
                id: "tool-call-1",
                name: "hmi.screen.create",
                input: { name: "Robot Overview" },
              },
            ],
            stopReason: "tool_calls",
          };
        }
        return { content: "done", stopReason: "completed" };
      },
    },
  });

  const result = await agent.run("Create robot overview", {
    actorId: "engineer",
    metadata: {
      environment: "design",
      correlationId: "corr-end-to-end",
    },
  });

  const events = await collectEvents(harness.events, {
    correlationId: "corr-end-to-end",
  });
  const types = events.map((event) => event.type);

  assert.equal(result.status, "completed");
  assert.ok(types.includes("agent.step.started"));
  assert.ok(types.includes("policy.evaluation.completed"));
  assert.ok(types.includes("approval.requested"));
  assert.ok(types.includes("approval.approved"));
  assert.ok(types.includes("tool.execution.started"));
  assert.ok(types.includes("tool.execution.succeeded"));
  assert.ok(types.includes("transaction.preparing"));
  assert.ok(types.includes("transaction.committed"));
  assert.ok(events.some((event) => event.toolCallId === "tool-call-1"));
  assert.ok(events.some((event) => event.changeSetId === "changeset-Robot Overview"));
  assert.ok(events.every((event) => event.correlationId === "corr-end-to-end"));
});
