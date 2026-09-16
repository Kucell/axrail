import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EventStoreCorruptionError,
  JsonlEventStore,
  collectEvents,
} from "../packages/events/src/index.ts";

test("JsonlEventStore persists events and resumes sequence after reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "axrail-events-"));
  const path = join(directory, "events.jsonl");

  try {
    const first = new JsonlEventStore({ path });
    const event1 = await first.append({
      id: "event-1",
      type: "session.created",
      version: "0.1",
      time: "2026-09-16T08:00:00.000Z",
      sessionId: "session-1",
      correlationId: "corr-1",
      data: { status: "active" },
    });
    const event2 = await first.append({
      id: "event-2",
      type: "transaction.committed",
      version: "0.1",
      time: "2026-09-16T08:00:01.000Z",
      sessionId: "session-1",
      transactionId: "tx-1",
      changeSetId: "cs-1",
      correlationId: "corr-1",
      data: { state: "committed" },
    });

    assert.equal(event1.sequence, 1);
    assert.equal(event2.sequence, 2);

    const reopened = new JsonlEventStore({ path });
    const event3 = await reopened.append({
      id: "event-3",
      type: "session.completed",
      version: "0.1",
      time: "2026-09-16T08:00:02.000Z",
      sessionId: "session-1",
      correlationId: "corr-1",
      data: { status: "completed" },
    });

    assert.equal(event3.sequence, 3);

    const correlated = await collectEvents(reopened, { correlationId: "corr-1" });
    assert.deepEqual(
      correlated.map((event) => [event.sequence, event.type]),
      [
        [1, "session.created"],
        [2, "transaction.committed"],
        [3, "session.completed"],
      ],
    );

    const latestTransaction = await reopened.latest({ transactionId: "tx-1" });
    assert.equal(latestTransaction?.id, "event-2");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JsonlEventStore redacts before durable persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "axrail-events-redact-"));
  const path = join(directory, "events.jsonl");

  try {
    const store = new JsonlEventStore({
      path,
      redact(event) {
        return {
          ...event,
          data: { redacted: true },
          metadata: undefined,
        };
      },
    });

    await store.append({
      id: "event-secret",
      type: "tool.execution.requested",
      version: "0.1",
      time: "2026-09-16T08:01:00.000Z",
      data: { secret: "do-not-persist" },
      metadata: { token: "also-secret" },
    });

    const reopened = new JsonlEventStore({ path });
    const persisted = await reopened.latest();

    assert.deepEqual(persisted?.data, { redacted: true });
    assert.equal(persisted?.metadata, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JsonlEventStore fails fast on corrupted persisted data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "axrail-events-corrupt-"));
  const path = join(directory, "events.jsonl");

  try {
    await writeFile(path, "{not-json}\n", "utf8");
    const store = new JsonlEventStore({ path });

    await assert.rejects(
      () => store.latest(),
      (error: unknown) => error instanceof EventStoreCorruptionError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
