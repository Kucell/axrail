import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryEventStore,
  type AxrailEvent,
  type EventQuery,
  type EventStore,
  type StoredAxrailEvent,
} from "../packages/events/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";

class SelectiveFailEventStore implements EventStore {
  private readonly backing = new InMemoryEventStore();

  constructor(
    private readonly shouldFail: (event: AxrailEvent) => boolean,
  ) {}

  async append<T = unknown>(event: AxrailEvent<T>): Promise<StoredAxrailEvent<T>> {
    if (this.shouldFail(event as AxrailEvent)) {
      throw new Error(`simulated EventStore failure for ${event.type}`);
    }
    return this.backing.append(event);
  }

  read(query?: EventQuery): AsyncIterable<StoredAxrailEvent> {
    return this.backing.read(query);
  }

  latest(query?: EventQuery): Promise<StoredAxrailEvent | undefined> {
    return this.backing.latest(query);
  }
}

test("best_effort audit policy does not turn observer failure into Tool failure", async () => {
  let executed = false;
  const harness = new HarnessRuntime({
    auditPolicy: "best_effort",
    eventStore: new SelectiveFailEventStore(
      (event) => event.source === "tool-runtime",
    ),
  });

  harness.tools.registry.register({
    name: "project.inspect",
    description: "Inspect project",
    risk: "L0",
    effect: "read",
    execute() {
      executed = true;
      return { ok: true };
    },
  });

  const result = await harness.tools.execute({
    id: "call-best-effort",
    name: "project.inspect",
    input: {},
  });

  assert.equal(result.ok, true);
  assert.equal(executed, true);
});

test("required_before_effect blocks Tool execution when audit checkpoint cannot persist", async () => {
  let executed = false;
  const harness = new HarnessRuntime({
    auditPolicy: "required_before_effect",
    eventStore: new SelectiveFailEventStore(
      (event) => event.type === "audit.effect.checkpoint",
    ),
  });

  harness.tools.registry.register({
    name: "project.inspect",
    description: "Inspect project",
    risk: "L0",
    effect: "read",
    execute() {
      executed = true;
      return { ok: true };
    },
  });

  const result = await harness.tools.execute({
    id: "call-required-effect",
    name: "project.inspect",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "audit_unavailable");
  assert.equal(executed, false);
});

test("required_before_effect blocks Transaction apply when audit checkpoint cannot persist", async () => {
  let applied = false;
  const harness = new HarnessRuntime({
    auditPolicy: "required_before_effect",
    eventStore: new SelectiveFailEventStore(
      (event) => event.type === "audit.effect.checkpoint",
    ),
  });

  const runtime = harness.createTransactionRuntime({
    allowWithoutPolicy: true,
    executor: {
      id: "audit-effect-executor",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  const result = await runtime.execute({
    id: "cs-audit-effect",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update", target: "project", risk: { level: "L2" } }],
  });

  assert.equal(result.state, "failed");
  assert.equal(result.error?.code, "audit_unavailable");
  assert.equal(applied, false);
});

test("required_before_commit blocks commit when commit checkpoint cannot persist", async () => {
  let applied = false;
  let committed = false;
  const harness = new HarnessRuntime({
    auditPolicy: "required_before_commit",
    eventStore: new SelectiveFailEventStore(
      (event) => event.type === "audit.commit.checkpoint",
    ),
  });

  const runtime = harness.createTransactionRuntime({
    allowWithoutPolicy: true,
    executor: {
      id: "audit-commit-executor",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
      commit() {
        committed = true;
      },
    },
  });

  const result = await runtime.execute({
    id: "cs-audit-commit",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [{ op: "update", target: "project", risk: { level: "L2" } }],
  });

  assert.equal(applied, true);
  assert.equal(committed, false);
  assert.equal(result.state, "failed");
  assert.equal(result.error?.code, "audit_unavailable");
});
