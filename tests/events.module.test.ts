import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryEventStore,
  SessionService,
  type AxrailEvent,
} from "../packages/events/src/index.ts";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

test("InMemoryEventStore applies redaction, sequence, filters, limits and latest queries", async () => {
  const store = new InMemoryEventStore({
    redact(event) {
      return { ...event, data: event.data === "secret" ? "redacted" : event.data };
    },
  });

  const base: AxrailEvent = {
    id: "e1",
    type: "test.event",
    version: "1",
    time: "2026-09-17T00:00:00.000Z",
    sessionId: "s1",
    transactionId: "t1",
    toolCallId: "tool1",
    changeSetId: "cs1",
    correlationId: "corr1",
    data: "secret",
  };
  const first = await store.append(base);
  const second = await store.append({
    ...base,
    id: "e2",
    sessionId: "s2",
    transactionId: "t2",
    toolCallId: "tool2",
    changeSetId: "cs2",
    correlationId: "corr2",
    data: "plain",
  });
  assert.equal(first.sequence, 1);
  assert.equal(first.data, "redacted");
  assert.equal(second.sequence, 2);
  assert.equal(store.size, 2);
  assert.equal(Object.isFrozen(first), true);

  assert.deepEqual((await collect(store.read())).map((e) => e.id), ["e1", "e2"]);
  assert.deepEqual((await collect(store.read({ afterSequence: 1 }))).map((e) => e.id), ["e2"]);
  assert.deepEqual((await collect(store.read({ sessionId: "s1" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ transactionId: "t1" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ toolCallId: "tool1" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ changeSetId: "cs1" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ correlationId: "corr1" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ limit: 1 }))).map((e) => e.id), ["e1"]);
  assert.equal((await store.latest())?.id, "e2");
  assert.equal((await store.latest({ sessionId: "s1" }))?.id, "e1");
  assert.equal(await store.latest({ sessionId: "missing" }), undefined);
});

test("InMemoryEventStore fails closed when redaction rejects persistence", async () => {
  const store = new InMemoryEventStore({ redact: () => undefined });
  await assert.rejects(
    store.append({ id: "e", type: "secret", version: "1", time: "2026-09-17T00:00:00.000Z" }),
    /redaction rejected persistence/,
  );
  assert.equal(store.size, 0);
});

test("SessionService covers create, append, load, terminal states and invalid transitions", async () => {
  const store = new InMemoryEventStore();
  let sessionCounter = 0;
  let eventCounter = 0;
  let tick = 0;
  const sessions = new SessionService({
    store,
    idFactory: () => `generated-${++sessionCounter}`,
    eventIdFactory: () => `event-${++eventCounter}`,
    now: () => `2026-09-17T00:00:0${tick++}.000Z`,
  });

  const created = await sessions.create({
    id: "s1",
    actor: { id: "u1", type: "human" },
    correlationId: "corr",
    metadata: { source: "test" },
  });
  assert.equal(created.id, "s1");
  assert.equal(created.status, "active");
  assert.deepEqual(created.metadata, { source: "test" });
  await assert.rejects(sessions.create({ id: "s1" }), /already exists/);

  const appended = await sessions.append("s1", {
    type: "custom.event",
    transactionId: "tx",
    toolCallId: "tool",
    changeSetId: "cs",
    artifactRefs: ["a"],
    actor: { id: "u2", type: "agent" },
    source: "test-source",
    correlationId: "corr2",
    causationId: "cause",
    data: { ok: true },
    metadata: { m: 1 },
  });
  assert.equal(appended.version, "1");
  assert.equal(appended.transactionId, "tx");
  const explicitVersion = await sessions.append("s1", { type: "v2.event", version: "2" });
  assert.equal(explicitVersion.version, "2");
  assert.equal((await sessions.load("s1"))?.status, "active");

  await sessions.complete("s1");
  assert.equal((await sessions.load("s1"))?.status, "completed");
  await assert.rejects(sessions.append("s1", { type: "too-late" }), /Cannot append to completed/);
  await assert.rejects(sessions.complete("s1"), /already completed/);

  const failed = await sessions.create({ id: "failed" });
  assert.equal(failed.status, "active");
  await sessions.fail("failed", { error: "x" });
  assert.equal((await sessions.load("failed"))?.status, "failed");

  await sessions.create({ id: "cancelled" });
  await sessions.cancel("cancelled", { reason: "user" });
  assert.equal((await sessions.load("cancelled"))?.status, "cancelled");

  const generated = await sessions.create();
  assert.equal(generated.id, "generated-1");
  assert.equal(await sessions.load("missing"), undefined);
  await assert.rejects(sessions.append("missing", { type: "x" }), /Session not found/);
  await assert.rejects(sessions.complete("missing"), /Session not found/);
});

test("SessionService default factories create usable ids and timestamps", async () => {
  const service = new SessionService({ store: new InMemoryEventStore() });
  const session = await service.create();
  assert.match(session.id, /^ses_/);
  assert.equal(Number.isNaN(Date.parse(session.createdAt)), false);
  const event = await service.append(session.id, { type: "x" });
  assert.match(event.id, /^evt_/);
});
