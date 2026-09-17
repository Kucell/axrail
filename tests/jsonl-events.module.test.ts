import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EventStoreCorruptionError,
  JsonlEventStore,
} from "../packages/events/src/index.ts";

async function tempPath(name = "events.jsonl"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "axrail-jsonl-module-"));
  return join(dir, name);
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function event(id: string, fields: Record<string, unknown> = {}) {
  return {
    id,
    type: "test",
    version: "1",
    time: "2026-09-17T00:00:00.000Z",
    ...fields,
  };
}

test("JsonlEventStore validates path, empty/nonexistent storage, filters and limits", async () => {
  assert.throws(() => new JsonlEventStore({ path: "" }), /path must not be empty/);

  const path = await tempPath();
  const store = new JsonlEventStore({ path });
  assert.deepEqual(await collect(store.read()), []);
  assert.equal(await store.latest(), undefined);

  await store.append(event("e1", { sessionId: "s", transactionId: "t", toolCallId: "tool", changeSetId: "cs", correlationId: "corr" }));
  await store.append(event("e2", { sessionId: "other" }));
  assert.deepEqual((await collect(store.read({ afterSequence: 1 }))).map((e) => e.id), ["e2"]);
  assert.deepEqual((await collect(store.read({ sessionId: "s" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ transactionId: "t" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ toolCallId: "tool" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ changeSetId: "cs" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ correlationId: "corr" }))).map((e) => e.id), ["e1"]);
  assert.deepEqual((await collect(store.read({ limit: 1 }))).map((e) => e.id), ["e1"]);
  assert.equal((await store.latest({ sessionId: "s" }))?.id, "e1");
  assert.equal(await store.latest({ sessionId: "missing" }), undefined);
});

test("JsonlEventStore redaction rejection and serialization failure do not poison later appends", async () => {
  let reject = true;
  const path = await tempPath();
  const redacted = new JsonlEventStore({
    path,
    redact(input) {
      if (reject) return undefined;
      return { ...input, data: "safe" };
    },
  });
  await assert.rejects(redacted.append(event("rejected")), /redaction rejected persistence/);
  reject = false;
  const stored = await redacted.append(event("accepted", { data: "secret" }));
  assert.equal(stored.sequence, 1);
  assert.equal(stored.data, "safe");

  const serializePath = await tempPath();
  const serializeStore = new JsonlEventStore({ path: serializePath });
  await assert.rejects(
    serializeStore.append(event("bigint", { data: 1n })),
    /Event is not JSON serializable/,
  );
  assert.equal((await serializeStore.append(event("after"))).sequence, 1);
});

test("JsonlEventStore detects every persisted event corruption class", async () => {
  const cases: Array<[string, RegExp]> = [
    ["{\n", /Invalid JSONL event at line 1/],
    ["null\n", /Invalid event object at line 1/],
    [JSON.stringify({ sequence: 0, id: "e", type: "x", version: "1", time: "t" }) + "\n", /Invalid event sequence/],
    [JSON.stringify({ sequence: 1, type: "x", version: "1", time: "t" }) + "\n", /Invalid event id/],
    [JSON.stringify({ sequence: 1, id: "e", version: "1", time: "t" }) + "\n", /Invalid event type/],
    [JSON.stringify({ sequence: 1, id: "e", type: "x", time: "t" }) + "\n", /Invalid event version/],
    [JSON.stringify({ sequence: 1, id: "e", type: "x", version: "1" }) + "\n", /Invalid event time/],
  ];

  for (const [text, expected] of cases) {
    const path = await tempPath();
    await writeFile(path, text, "utf8");
    const store = new JsonlEventStore({ path });
    await assert.rejects(store.latest(), (error: unknown) => {
      assert.equal(error instanceof EventStoreCorruptionError, true);
      assert.match((error as Error).message, expected);
      return true;
    });
  }

  const nonIncreasing = await tempPath();
  await writeFile(
    nonIncreasing,
    [
      { sequence: 2, id: "e1", type: "x", version: "1", time: "t" },
      { sequence: 2, id: "e2", type: "x", version: "1", time: "t" },
    ].map((value) => JSON.stringify(value)).join("\n") + "\n",
    "utf8",
  );
  await assert.rejects(new JsonlEventStore({ path: nonIncreasing }).latest(), /sequence is not strictly increasing/);
});

test("JsonlEventStore retries initialization after a transient filesystem error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "axrail-jsonl-dir-"));
  await mkdir(join(dir, "as-directory"));
  const store = new JsonlEventStore({ path: join(dir, "as-directory") });
  await assert.rejects(store.latest());
  await assert.rejects(store.latest());
});

test("JsonlEventStore ignores blank lines and resumes sequence from persisted tail", async () => {
  const path = await tempPath();
  await writeFile(
    path,
    `\n${JSON.stringify({ sequence: 3, id: "e3", type: "x", version: "1", time: "t" })}\n\n`,
    "utf8",
  );
  const store = new JsonlEventStore({ path });
  assert.equal((await store.append(event("e4"))).sequence, 4);
});
