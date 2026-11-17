import assert from "node:assert/strict";
import test from "node:test";

import { TransactionRuntime } from "../packages/transactions/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";

function proposal(id: string) {
  return {
    id,
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update" as const, target: "mock-hmi-screen", risk: { level: "L1" as const } }],
  };
}

for (const phase of ["apply", "verify", "commit"] as const) {
  test(`Transaction conservative mode preserves uncertain effect when ${phase} acknowledgement fails`, async () => {
    let applies = 0;
    const events: string[] = [];
    const tx = new TransactionRuntime({
      allowWithoutPolicy: true,
      effectFailureMode: "uncertain",
      executor: {
        id: "mock-device",
        mode: "atomic",
        apply() {
          applies += 1; // Simulates a remote effect before the ACK is lost.
          if (phase === "apply") throw new Error("lost apply acknowledgement");
          return {};
        },
        verify() {
          if (phase === "verify") throw new Error("lost verify acknowledgement");
          return true;
        },
        commit() {
          if (phase === "commit") throw new Error("lost commit acknowledgement");
        },
      },
      onEvent(event) { events.push(event.type); },
    });

    const result = await tx.execute(proposal(`cs-uncertain-${phase}`));
    assert.equal(result.state, "execution_uncertain");
    assert.equal(result.error?.code, "execution_uncertain");
    assert.match(result.error?.message ?? "", new RegExp(phase));
    assert.equal(applies, 1);
    assert.equal(events.filter((event) => event === "transaction.execution_uncertain").length, 1);
    assert.equal(events.includes("transaction.committed"), false);
  });
}

test("Transaction default mode preserves existing failure codes for compatibility", async () => {
  const result = await new TransactionRuntime({
    allowWithoutPolicy: true,
    executor: {
      id: "mock-device",
      mode: "atomic",
      apply() { throw new Error("link failure"); },
    },
  }).execute(proposal("cs-legacy-mode"));
  assert.equal(result.state, "failed");
  assert.equal(result.error?.code, "execution_failed");
});

test("Harness passes conservative uncertainty preference to transaction runtime", async () => {
  const harness = new HarnessRuntime();
  await harness.mountAdapter({
    id: "mock-device",
    version: "1.0.0",
    async capabilities() {
      return { adapterId: "mock-device", adapterVersion: "1.0.0", capabilities: {} };
    },
  });
  let attempts = 0;
  const result = await harness.executeChangeSet(proposal("cs-harness-uncertain"), {
    executor: {
      id: "mock-executor",
      providerId: "mock-device",
      mode: "atomic",
      apply() {
        attempts += 1;
        throw new Error("remote operation may have completed");
      },
    },
    effectFailureMode: "uncertain",
    allowWithoutPolicy: true,
  });
  assert.equal(result.state, "execution_uncertain");
  assert.equal(result.error?.code, "execution_uncertain");
  assert.equal(attempts, 1);
});
