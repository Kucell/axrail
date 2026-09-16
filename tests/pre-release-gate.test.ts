import assert from "node:assert/strict";
import test from "node:test";

import { HarnessRuntime } from "../packages/harness/src/index.ts";
import { ToolRuntime } from "../packages/tools/src/index.ts";
import { TransactionRuntime } from "../packages/transactions/src/index.ts";

test("Transaction lifecycle observer failure cannot relabel a successful commit", async () => {
  let committed = false;
  const runtime = new TransactionRuntime({
    allowWithoutPolicy: true,
    executor: {
      id: "observer-isolation",
      mode: "atomic",
      apply() {
        return {};
      },
      commit() {
        committed = true;
      },
    },
    onEvent(event) {
      if (event.type === "transaction.committed") {
        throw new Error("telemetry store unavailable");
      }
    },
  });

  const result = await runtime.execute({
    id: "cs-observer-isolation",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update", target: "draft", risk: { level: "L1" } }],
  });

  assert.equal(committed, true);
  assert.equal(result.state, "committed");
  assert.equal(result.error, undefined);
});

test("side-effecting Tool timeout aborts execution scope and reports uncertain outcome", async () => {
  let timeoutSignalObserved = false;
  let lateEffect = false;
  const tools = new ToolRuntime({
    policy: {
      evaluate() {
        return { allow: true };
      },
    },
  });

  tools.registry.register({
    name: "engineering.slow-write",
    description: "Slow engineering write",
    risk: "L2",
    effect: "engineering-write",
    timeoutMs: 10,
    execute(_input, context) {
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          lateEffect = true;
          resolve("late-effect");
        }, 80);
        context.signal?.addEventListener(
          "abort",
          () => {
            timeoutSignalObserved = true;
            clearTimeout(timer);
            resolve("aborted-before-effect");
          },
          { once: true },
        );
      });
    },
  });

  const result = await tools.execute({
    id: "slow-write",
    name: "engineering.slow-write",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "execution_uncertain");
  assert.deepEqual(result.error?.details, {
    timeoutMs: 10,
    abortRequested: true,
    effectUncertain: true,
    retrySafe: false,
  });
  assert.equal(timeoutSignalObserved, true);

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(lateEffect, false);
});

test("AdapterHost scopes Policy providers to their owning Adapter", async () => {
  const harness = new HarnessRuntime();
  let adapterBPolicyCalls = 0;

  const makeAdapter = (id: string, deny = false) => ({
    id,
    version: "0.1.0",
    async capabilities() {
      return {
        adapterId: id,
        adapterVersion: "0.1.0",
        capabilities: { "engineering.write": { level: "exact" as const } },
      };
    },
    tools() {
      return [
        {
          name: "engineering.write",
          description: "Write engineering state",
          risk: "L2" as const,
          effect: "engineering-write" as const,
          execute() {
            return { provider: id };
          },
        },
      ];
    },
    policies() {
      return [
        {
          id: "default-policy",
          evaluate(input: { adapterId?: string }) {
            if (id === "adapter-b") adapterBPolicyCalls += 1;
            assert.equal(input.adapterId, id);
            return { effect: deny ? "deny" as const : "allow" as const };
          },
        },
      ];
    },
  });

  await harness.mountAdapter(makeAdapter("adapter-a"));
  await harness.mountAdapter(makeAdapter("adapter-b", true));

  const providerIds = harness.adapters.policy.list().map((provider) => provider.id);
  assert.deepEqual(providerIds, ["adapter-a:default-policy", "adapter-b:default-policy"]);

  const result = await harness.tools.execute(
    { id: "write-a", name: "engineering.write", input: {} },
    { providerIds: ["adapter-a"] },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { provider: "adapter-a" });
  assert.equal(adapterBPolicyCalls, 0);
});

test("multi-Adapter Transaction evaluates every Adapter policy with deny-overrides", async () => {
  const harness = new HarnessRuntime();
  const evaluated: string[] = [];
  let applied = false;

  for (const [id, effect] of [
    ["adapter-a", "allow"],
    ["adapter-b", "deny"],
  ] as const) {
    await harness.mountAdapter({
      id,
      version: "0.1.0",
      async capabilities() {
        return {
          adapterId: id,
          adapterVersion: "0.1.0",
          capabilities: {},
        };
      },
      policies() {
        return [
          {
            id: "transaction-policy",
            evaluate(input) {
              evaluated.push(String(input.adapterId));
              return { effect };
            },
          },
        ];
      },
    });
  }

  const runtime = harness.createTransactionRuntime({
    executor: {
      id: "multi-adapter",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  const result = await runtime.execute(
    {
      id: "cs-multi-adapter",
      protocolVersion: "0.1",
      artifacts: [],
      operations: [{ op: "update", target: "shared", risk: { level: "L2" } }],
    },
    { adapterIds: ["adapter-a", "adapter-b"] },
  );

  assert.deepEqual(evaluated, ["adapter-a", "adapter-b"]);
  assert.equal(result.state, "rejected");
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(applied, false);
});
