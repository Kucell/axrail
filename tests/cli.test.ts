import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli } from "../packages/cli/src/index.ts";
import { JsonlEventStore } from "../packages/events/src/index.ts";

function captureIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      writeStdout(text: string) {
        stdout += text;
      },
      writeStderr(text: string) {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

test("CLI help and version are deterministic", async () => {
  const help = captureIo();
  assert.equal(await runCli(["--help"], help.io), 0);
  assert.match(help.stdout(), /Axrail CLI/);
  assert.match(help.stdout(), /intentionally read-only\/diagnostic/);

  const version = captureIo();
  assert.equal(
    await runCli(["--version"], version.io, { version: "0.1.0-test" }),
    0,
  );
  assert.equal(version.stdout(), "0.1.0-test\n");
});

test("CLI inspects durable event logs with correlation filters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "axrail-cli-events-"));
  const path = join(directory, "events.jsonl");

  try {
    const store = new JsonlEventStore({ path });
    await store.append({
      id: "e-1",
      type: "session.created",
      version: "0.1",
      time: "2026-09-16T08:20:00.000Z",
      sessionId: "s-1",
      correlationId: "corr-a",
      data: {},
    });
    await store.append({
      id: "e-2",
      type: "session.created",
      version: "0.1",
      time: "2026-09-16T08:20:01.000Z",
      sessionId: "s-2",
      correlationId: "corr-b",
      data: {},
    });

    const capture = captureIo();
    const code = await runCli(
      ["events", "inspect", path, "--correlation", "corr-a"],
      capture.io,
    );

    assert.equal(code, 0);
    const events = JSON.parse(capture.stdout()) as Array<{ id: string }>;
    assert.deepEqual(events.map((event) => event.id), ["e-1"]);
    assert.equal(capture.stderr(), "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI calculates canonical ChangeSet digest from JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "axrail-cli-changeset-"));
  const path = join(directory, "changeset.json");

  try {
    await writeFile(
      path,
      JSON.stringify({
        id: "cs-cli",
        protocolVersion: "0.1",
        artifacts: [],
        operations: [{ op: "update", target: "draft", value: { b: 2, a: 1 } }],
      }),
      "utf8",
    );

    const first = captureIo();
    const second = captureIo();
    assert.equal(await runCli(["changeset", "digest", path], first.io), 0);
    assert.equal(await runCli(["changeset", "digest", path], second.io), 0);

    const result = JSON.parse(first.stdout()) as {
      changeSetId: string;
      digest: string;
    };
    assert.equal(result.changeSetId, "cs-cli");
    assert.match(result.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(first.stdout(), second.stdout());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI returns non-zero exit code for invalid usage", async () => {
  const capture = captureIo();
  assert.equal(await runCli(["events", "inspect"], capture.io), 2);
  assert.match(capture.stderr(), /Usage: axrail events inspect/);

  const unknown = captureIo();
  assert.equal(await runCli(["deploy"], unknown.io), 2);
  assert.match(unknown.stderr(), /Unknown command: deploy/);
});
