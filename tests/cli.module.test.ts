import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../packages/cli/src/index.ts";

type Output = { stdout: string[]; stderr: string[] };

function io(output: Output) {
  return {
    writeStdout(text: string) { output.stdout.push(text); },
    writeStderr(text: string) { output.stderr.push(text); },
  };
}

async function jsonFile(value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "axrail-cli-module-"));
  const path = join(dir, "input.json");
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

test("CLI covers help aliases, default/custom versions and unknown commands", async () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const output: Output = { stdout: [], stderr: [] };
    assert.equal(await runCli(args, io(output)), 0);
    assert.match(output.stdout.join(""), /Axrail CLI/);
    assert.deepEqual(output.stderr, []);
  }

  let output: Output = { stdout: [], stderr: [] };
  assert.equal(await runCli(["--version"], io(output)), 0);
  assert.equal(output.stdout.join(""), "0.0.0-dev\n");

  output = { stdout: [], stderr: [] };
  assert.equal(await runCli(["version"], io(output), { version: "1.2.3" }), 0);
  assert.equal(output.stdout.join(""), "1.2.3\n");

  output = { stdout: [], stderr: [] };
  assert.equal(await runCli(["unknown"], io(output)), 2);
  assert.match(output.stderr.join(""), /Unknown command: unknown/);
});

test("CLI events inspect validates usage and every filter option", async () => {
  let output: Output = { stdout: [], stderr: [] };
  assert.equal(await runCli(["events"], io(output)), 2);
  assert.match(output.stderr.join(""), /Usage: axrail events inspect/);

  const dir = await mkdtemp(join(tmpdir(), "axrail-cli-events-"));
  const path = join(dir, "events.jsonl");
  const events = [
    { sequence: 1, id: "e1", type: "x", version: "1", time: "2026-09-17T00:00:00Z", sessionId: "s", transactionId: "t", correlationId: "c", changeSetId: "cs" },
    { sequence: 2, id: "e2", type: "x", version: "1", time: "2026-09-17T00:00:01Z", sessionId: "other" },
  ];
  await writeFile(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");

  output = { stdout: [], stderr: [] };
  assert.equal(await runCli([
    "events", "inspect", path,
    "--session", "s",
    "--transaction", "t",
    "--correlation", "c",
    "--changeset", "cs",
    "--limit", "1",
  ], io(output)), 0);
  const parsed = JSON.parse(output.stdout.join("")) as Array<{ id: string }>;
  assert.deepEqual(parsed.map((event) => event.id), ["e1"]);

  for (const flags of [
    ["--session"],
    ["--limit", "0"],
    ["--limit", "1.2"],
    ["--unknown", "x"],
  ]) {
    output = { stdout: [], stderr: [] };
    assert.equal(await runCli(["events", "inspect", path, ...flags], io(output)), 1);
    assert.ok(output.stderr.length > 0);
  }
});

test("CLI changeset digest validates usage, JSON and required document fields", async () => {
  let output: Output = { stdout: [], stderr: [] };
  assert.equal(await runCli(["changeset"], io(output)), 2);
  assert.match(output.stderr.join(""), /Usage: axrail changeset digest/);

  output = { stdout: [], stderr: [] };
  const validPath = await jsonFile({ id: "cs", protocolVersion: "0.1", artifacts: [], operations: [] });
  assert.equal(await runCli(["changeset", "digest", validPath, "extra"], io(output)), 2);

  const invalidValues: Array<[unknown, RegExp]> = [
    [[], /JSON object/],
    [{ protocolVersion: "0.1", artifacts: [], operations: [] }, /ChangeSet.id/],
    [{ id: "cs", artifacts: [], operations: [] }, /protocolVersion/],
    [{ id: "cs", protocolVersion: "0.1", artifacts: {}, operations: [] }, /artifacts must be an array/],
    [{ id: "cs", protocolVersion: "0.1", artifacts: [], operations: {} }, /operations must be an array/],
  ];
  for (const [value, expected] of invalidValues) {
    output = { stdout: [], stderr: [] };
    assert.equal(await runCli(["changeset", "digest", await jsonFile(value)], io(output)), 1);
    assert.match(output.stderr.join(""), expected);
  }

  const dir = await mkdtemp(join(tmpdir(), "axrail-cli-bad-json-"));
  const badJson = join(dir, "bad.json");
  await writeFile(badJson, "{", "utf8");
  output = { stdout: [], stderr: [] };
  assert.equal(await runCli(["changeset", "digest", badJson], io(output)), 1);
  assert.ok(output.stderr.join("").length > 0);

  output = { stdout: [], stderr: [] };
  assert.equal(await runCli(["changeset", "digest", join(dir, "missing.json")], io(output)), 1);
  assert.ok(output.stderr.join("").length > 0);
});
