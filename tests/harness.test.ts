import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalService,
  CallbackApprovalProvider,
} from "../packages/approval/src/index.ts";
import { collectEvents, replaySession } from "../packages/events/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";

test("HarnessRuntime preserves fail-closed privileged tool behavior", async () => {
  const harness = new HarnessRuntime();
  harness.tools.registry.register({
    name: "engineering.modify",
    description: "Modify engineering data",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      return "should-not-run";
    },
  });

  const result = await harness.tools.execute({
    id: "call-1",
    name: "engineering.modify",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_unavailable");
});

test("HarnessRuntime composes adapter policy and approval for privileged tools", async () => {
  let executed = false;
  let approvalRequests = 0;

  const approval = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => {
      approvalRequests += 1;
      return {
        requestId: request.id,
        decision: "approved",
        approver: {
          id: "controls-engineer",
          type: "human",
          roles: ["controls-engineer"],
        },
        decidedAt: new Date().toISOString(),
      };
    }),
  });

  const harness = new HarnessRuntime({ approval, environment: "design" });
  await harness.mountAdapter({
    id: "mock-engineering",
    version: "0.1.0",
    async capabilities() {
      return {
        adapterId: "mock-engineering",
        adapterVersion: "0.1.0",
        capabilities: {
          "engineering.modify": { level: "exact" },
        },
      };
    },
    tools() {
      return [
        {
          name: "engineering.modify",
          description: "Governed engineering modification",
          risk: "L2",
          effect: "engineering-write",
          execute() {
            executed = true;
            return { changed: true };
          },
        },
      ];
    },
    policies() {
      return [
        {
          id: "require-engineering-approval",
          evaluate(input) {
            return input.action === "engineering.modify"
              ? {
                  effect: "require-approval",
                  reason: "Engineering modification requires approval",
                }
              : undefined;
          },
        },
      ];
    },
  });

  const result = await harness.tools.execute(
    { id: "call-2", name: "engineering.modify", input: {} },
    { actorId: "operator-1", metadata: { environment: "design" } },
  );

  assert.equal(result.ok, true);
  assert.equal(executed, true);
  assert.equal(approvalRequests, 1);
});

test("HarnessAgent creates replayable session and agent events", async () => {
  let calls = 0;
  const harness = new HarnessRuntime({
    idFactory: (prefix) => `${prefix}-fixed-${++calls}`,
    now: (() => {
      let tick = 0;
      return () => `2026-09-16T08:10:${String(tick++).padStart(2, "0")}.000Z`;
    })(),
  });

  const agent = harness.createAgent({
    model: {
      id: "echo-model",
      async complete(request) {
        const user = [...request.messages].reverse().find((message) => message.role === "user");
        return {
          content: `ack:${user?.content ?? ""}`,
          stopReason: "completed",
        };
      },
    },
  });

  const result = await agent.run("inspect project", {
    actorId: "engineer-1",
    metadata: { correlationId: "corr-harness-1" },
  });

  const events = await collectEvents(harness.events, { sessionId: result.sessionId });
  const replayed = await replaySession(harness.events, result.sessionId);

  assert.equal(result.status, "completed");
  assert.equal(result.content, "ack:inspect project");
  assert.equal(replayed?.status, "completed");
  assert.ok(events.some((event) => event.type === "session.created"));
  assert.ok(events.some((event) => event.type === "agent.step.started"));
  assert.ok(events.some((event) => event.type === "agent.completed"));
  assert.ok(events.some((event) => event.type === "session.completed"));
});
