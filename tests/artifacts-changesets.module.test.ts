import assert from "node:assert/strict";
import test from "node:test";

import {
  ArtifactProviderRegistry,
  ArtifactVersionConflictError,
  artifactKey,
  assertArtifactVersion,
  type ArtifactProvider,
} from "../packages/artifacts/src/index.ts";
import {
  canonicalJson,
  digestChangeSet,
  highestDeclaredRisk,
  isGenericChangeOperation,
  referencedOperationIds,
  snapshotChangeSet,
  type ChangeSet,
} from "../packages/changesets/src/index.ts";

function provider(id: string, version = "1"): ArtifactProvider {
  return {
    id,
    async get(ref) {
      return { ...ref, provider: id, version };
    },
    async exists() {
      return true;
    },
    async currentVersion() {
      return version;
    },
  };
}

function changeSet(): ChangeSet {
  return {
    id: "cs-1",
    protocolVersion: "0.1",
    artifacts: [],
    operations: [
      { id: "one", op: "update", target: "a", risk: { level: "L1" } },
      { id: "two", op: "update", target: "b", dependsOn: ["one"], risk: { level: "L4" } },
      { id: "three", op: "update", target: "c", dependsOn: ["one", "external"] },
    ],
  };
}

test("ArtifactProviderRegistry validates providers and resolves explicit/single-provider routing", async () => {
  const registry = new ArtifactProviderRegistry();
  assert.throws(() => registry.register(provider("")), /id must not be empty/);

  const only = provider("only", "7");
  registry.register(only);
  assert.equal(registry.has("only"), true);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get("only"), only);
  assert.throws(() => registry.register(only), /already registered/);
  assert.throws(() => registry.get("missing"), /not found/);

  assert.equal(registry.providerFor({ id: "x", type: "t" }), only);
  assert.equal(registry.providerFor({ id: "x", type: "t", provider: "only" }), only);
  assert.equal((await registry.resolve({ id: "x", type: "t" })).version, "7");

  registry.register(provider("second"));
  assert.throws(() => registry.providerFor({ id: "x", type: "t" }), /provider is required/);
  assert.equal(registry.unregister("second"), true);
  assert.equal(registry.unregister("second"), false);
});

test("Artifact version helpers cover match, no-op and conflict semantics", async () => {
  const p = provider("p", "2");
  await assertArtifactVersion(p, { id: "x", type: "t" });
  await assertArtifactVersion(p, { id: "x", type: "t", version: "2" });
  await assert.rejects(
    assertArtifactVersion(p, { id: "x", type: "t", version: "1" }),
    (error: unknown) => {
      assert.equal(error instanceof ArtifactVersionConflictError, true);
      const conflict = error as ArtifactVersionConflictError;
      assert.equal(conflict.expected, "1");
      assert.equal(conflict.actual, "2");
      assert.match(conflict.message, /expected 1, got 2/);
      return true;
    },
  );

  const none = new ArtifactVersionConflictError();
  assert.match(none.message, /expected <none>, got <none>/);
  assert.equal(artifactKey({ id: "x" }), "x");
  assert.equal(artifactKey({ id: "x", provider: "p" }), "p:x");
});

test("ChangeSet canonical JSON normalizes object order and unsupported JSON values", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalJson([1, undefined, () => 1, Symbol("x"), null]), "[1,null,null,null,null]");
  assert.equal(canonicalJson({ keep: true, drop: undefined, fn: () => 1, sym: Symbol("x") }), '{"keep":true}');
  assert.equal(canonicalJson("x"), '"x"');
  assert.equal(canonicalJson(false), "false");
  assert.equal(canonicalJson(null), "null");
  assert.throws(() => canonicalJson(Number.NaN), /non-finite/);
  assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), /non-finite/);
  assert.throws(() => canonicalJson(1n), /Unsupported value.*bigint/);
});

test("ChangeSet snapshot is canonical, deeply frozen and digestable", async () => {
  const original: ChangeSet = {
    id: "snapshot",
    protocolVersion: "0.1",
    artifacts: [{ id: "p", type: "project", version: "1" }],
    operations: [{ op: "update", target: "p", value: { nested: { value: 1 } } }],
  };
  const snapshot = snapshotChangeSet(original);
  assert.notEqual(snapshot, original);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.operations), true);
  assert.equal(Object.isFrozen(snapshot.operations[0]?.value), true);
  assert.match(await digestChangeSet(snapshot), /^sha256:[0-9a-f]{64}$/);
});

test("ChangeSet inspection helpers cover missing risks, ordering and dependency deduplication", () => {
  const cs = changeSet();
  assert.equal(highestDeclaredRisk(cs), "L4");
  assert.deepEqual([...referencedOperationIds(cs)].sort(), ["external", "one"]);
  assert.equal(highestDeclaredRisk({ ...cs, operations: [{ op: "update", target: "x" }] }), undefined);

  assert.equal(isGenericChangeOperation("create"), true);
  assert.equal(isGenericChangeOperation("unbind"), true);
  assert.equal(isGenericChangeOperation("vendor-op"), false);
});
