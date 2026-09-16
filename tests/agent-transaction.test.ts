import assert from "node:assert/strict";
import test from "node:test";

import { AgentLoop } from "../packages/agent/src/index.ts";
import { ArtifactProviderRegistry } from "../packages/artifacts/src/index.ts";
import { ToolRuntime } from "../packages/tools/src/index.ts";
import { TransactionRuntime } from "../packages/transactions/src/index.ts";

test("AgentLoop executes model tool calls sequentially", async () => {
  const order: string[] = [];
  const tools = new ToolRuntime({
    policy: {
      evaluate() {
        return { allow: true };
      },
    },
  });

  tools.registry.register({
    name: "engineering.first",
    description: "First deterministic engineering action",
    risk: "L2",
    effect: "engineering-write",
    async execute() {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("first:end");
      return "first-ok";
    },
  });
  tools.registry.register({
    name: "engineering.second",
    description: "Second deterministic engineering action",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      order.push("second:start");
      order.push("second:end");
      return "second-ok";
    },
  });

  let modelCalls = 0;
  const agent = new AgentLoop({
    tools,
    model: {
      id: "test-model",
      async complete() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            toolCalls: [
              { id: "tc-1", name: "engineering.first", input: {} },
              { id: "tc-2", name: "engineering.second", input: {} },
            ],
            stopReason: "tool_calls",
          };
        }
        return { content: "done", stopReason: "completed" };
      },
    },
  });

  const result = await agent.run("perform both steps");

  assert.equal(result.status, "completed");
  assert.deepEqual(order, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("Compensating transaction may change artifact version during apply and still commit", async () => {
  let version = "1";
  const artifacts = new ArtifactProviderRegistry();
  artifacts.register({
    id: "mock",
    async get(ref) {
      return { ...ref, version, provider: "mock" };
    },
    async exists() {
      return true;
    },
    async currentVersion() {
      return version;
    },
  });

  const runtime = new TransactionRuntime({
    artifacts,
    allowWithoutPolicy: true,
    executor: {
      id: "compensating-executor",
      mode: "compensating",
      apply() {
        version = "2";
        return { externalRef: "apply-1" };
      },
      verify() {
        return version === "2";
      },
      commit() {},
      rollback() {
        version = "1";
        return { complete: true };
      },
    },
  });

  const result = await runtime.execute({
    id: "changeset-compensating",
    protocolVersion: "0.1",
    artifacts: [
      {
        id: "project:compensating",
        type: "industrial.hmi.project",
        version: "1",
        provider: "mock",
      },
    ],
    operations: [{ op: "update", target: "screen:overview" }],
  });

  assert.equal(result.state, "committed");
  assert.equal(version, "2");
});

test("Transaction rollback is explicit and records rolled_back state", async () => {
  let applied = false;
  const runtime = new TransactionRuntime({
    allowWithoutPolicy: true,
    executor: {
      id: "rollback-executor",
      mode: "compensating",
      apply() {
        applied = true;
        return {};
      },
      rollback() {
        applied = false;
        return { complete: true };
      },
    },
  });

  const tx = runtime.begin({
    id: "changeset-rollback",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update", target: "draft" }],
  });

  await tx.prepare();
  await tx.evaluatePolicy();
  await tx.validate();
  await tx.apply();
  assert.equal(applied, true);

  await tx.rollback();

  assert.equal(applied, false);
  assert.equal(tx.state, "rolled_back");
});
