import assert from "node:assert/strict";
import test from "node:test";

import {
  AdapterContextRegistry,
  AdapterHost,
  AdapterRegistry,
  assertSelectionProvider,
  createSelectionContext,
  selectedTargetIds,
  requireCapability,
  supportsCapability,
  type AxrailAdapter,
} from "../packages/adapter-sdk/src/index.ts";

function makeAdapter(
  id = "adapter-a",
  version = "1.0.0",
  overrides: Partial<AxrailAdapter> = {},
): AxrailAdapter {
  return {
    id,
    version,
    async capabilities() {
      return { adapterId: id, adapterVersion: version, capabilities: {} };
    },
    ...overrides,
  };
}

test("AdapterRegistry validates identity and enforces lifecycle transitions", async () => {
  const registry = new AdapterRegistry();

  assert.throws(() => registry.register(makeAdapter("", "1.0.0")), /id must not be empty/);
  assert.throws(() => registry.register(makeAdapter("missing-version", "")), /version must not be empty/);

  registry.register(makeAdapter());
  assert.equal(registry.has("adapter-a"), true);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get("adapter-a").state, "registered");
  assert.throws(() => registry.register(makeAdapter()), /already registered/);
  assert.throws(() => registry.get("missing"), /Adapter not found/);

  const ready = await registry.initialize("adapter-a", { environment: "test" });
  assert.equal(ready.state, "ready");
  await assert.rejects(registry.initialize("adapter-a"), /cannot initialize from state ready/);

  const active = await registry.start("adapter-a");
  assert.equal(active.state, "active");
  await assert.rejects(registry.start("adapter-a"), /cannot start from state active/);
  assert.throws(() => registry.unregister("adapter-a"), /Cannot unregister/);

  const stopped = await registry.stop("adapter-a");
  assert.equal(stopped.state, "stopped");
  assert.equal((await registry.stop("adapter-a")).state, "stopped");
  assert.equal(registry.unregister("adapter-a"), true);
  assert.equal(registry.unregister("adapter-a"), false);
});

test("AdapterRegistry records lifecycle failures and rejects manifest mismatch", async () => {
  const initFailure = new AdapterRegistry();
  initFailure.register(makeAdapter("init-fail", "1", {
    initialize() {
      throw "initialization failed";
    },
  }));
  await assert.rejects(initFailure.initialize("init-fail"), /initialization failed/);
  assert.equal(initFailure.get("init-fail").state, "failed");
  assert.match(initFailure.get("init-fail").error?.message ?? "", /initialization failed/);
  assert.equal((await initFailure.stop("init-fail")).state, "stopped");

  const idMismatch = new AdapterRegistry();
  idMismatch.register(makeAdapter("expected", "1", {
    async capabilities() {
      return { adapterId: "other", adapterVersion: "1", capabilities: {} };
    },
  }));
  await assert.rejects(idMismatch.initialize("expected"), /adapterId mismatch/);

  const versionMismatch = new AdapterRegistry();
  versionMismatch.register(makeAdapter("versioned", "1", {
    async capabilities() {
      return { adapterId: "versioned", adapterVersion: "2", capabilities: {} };
    },
  }));
  await assert.rejects(versionMismatch.initialize("versioned"), /version mismatch/);

  const startFailure = new AdapterRegistry();
  startFailure.register(makeAdapter("start-fail", "1", {
    start() {
      throw new Error("start failed");
    },
  }));
  await startFailure.initialize("start-fail");
  await assert.rejects(startFailure.start("start-fail"), /start failed/);
  assert.equal(startFailure.get("start-fail").state, "failed");

  const stopFailure = new AdapterRegistry();
  stopFailure.register(makeAdapter("stop-fail", "1", {
    stop() {
      throw "stop failed";
    },
  }));
  await stopFailure.initialize("stop-fail");
  await stopFailure.start("stop-fail");
  await assert.rejects(stopFailure.stop("stop-fail"), /stop failed/);
  assert.equal(stopFailure.get("stop-fail").state, "failed");

  const invalidStop = new AdapterRegistry();
  invalidStop.register(makeAdapter("registered-only"));
  await assert.rejects(invalidStop.stop("registered-only"), /cannot stop from state registered/);
});

test("AdapterContextRegistry scopes duplicate ids by adapter and disposes registrations", async () => {
  const contexts = new AdapterContextRegistry();
  const provider = {
    id: "project",
    async build(request: { purpose: string }) {
      return { providerId: "adapter-a", kind: request.purpose, content: { ok: true } };
    },
  };
  const dispose = contexts.register("adapter-a", provider);
  contexts.register("adapter-b", {
    id: "project",
    async build(request) {
      return { providerId: "adapter-b", kind: request.purpose, content: { ok: true } };
    },
  });

  assert.throws(() => contexts.register("adapter-a", provider), /already registered/);
  assert.equal(contexts.get("adapter-a", "project"), provider);
  assert.throws(() => contexts.get("adapter-a", "missing"), /not found/);
  assert.equal(contexts.list().length, 2);
  assert.equal(contexts.list("adapter-a").length, 1);
  assert.equal((await contexts.buildAll({ purpose: "inspect" }, "adapter-a"))[0]?.kind, "inspect");
  assert.equal((await contexts.buildAll({ purpose: "all" })).length, 2);

  dispose();
  assert.equal(contexts.list("adapter-a").length, 0);
});

test("AdapterHost fails closed on provider ownership conflicts and supports explicit context", async () => {
  const host = new AdapterHost();
  await host.mount(makeAdapter("context-hmi", "1", {
    context() {
      return [
        {
          id: "public",
          async build() {
            return { providerId: "context-hmi", kind: "public", content: "ok" };
          },
        },
        {
          id: "secret",
          async build() {
            return { providerId: "context-hmi", kind: "secret", content: "hidden", sensitive: true };
          },
        },
      ];
    },
    approvals() {
      return [{ async requestApproval(request) { return { requestId: request.id, decision: "rejected", decidedAt: new Date().toISOString() }; } }];
    },
    transactions() {
      return { mode: "best_effort" };
    },
  }));

  await assert.rejects(
    host.buildContext({ purpose: "inspect" }, { adapterIds: [] }),
    /requires at least one adapterId/,
  );
  assert.deepEqual(
    (await host.buildContext({ purpose: "inspect" }, { adapterIds: ["context-hmi", "context-hmi"] })).map((f) => f.kind),
    ["public"],
  );
  assert.deepEqual(
    (await host.buildContext({ purpose: "inspect" }, { adapterIds: ["context-hmi"], includeSensitive: true })).map((f) => f.kind),
    ["public", "secret"],
  );
  assert.equal(host.get("context-hmi").approvals.length, 1);
  assert.equal(host.get("context-hmi").transactionParticipant?.mode, "best_effort");
  assert.equal(host.list().length, 1);
  await assert.rejects(host.mount(makeAdapter("context-hmi", "1")), /already mounted/);
  await host.unmount("missing");
  await host.unmount("context-hmi");
  assert.throws(() => host.get("context-hmi"), /Mounted adapter not found/);

  await assert.rejects(
    new AdapterHost().mount(makeAdapter("tool-owner", "1", {
      tools() {
        return [{ name: "x", providerId: "other", description: "x", risk: "L0", effect: "read", execute: () => null }];
      },
    })),
    /cannot register Tool/,
  );

  await assert.rejects(
    new AdapterHost().mount(makeAdapter("validator-owner", "1", {
      validators() {
        return [{ id: "v", providerId: "other", validate: () => [] }];
      },
    })),
    /cannot register Validator/,
  );

  await assert.rejects(
    new AdapterHost().mount(makeAdapter("policy-owner", "1", {
      policies() {
        return [{ id: "", evaluate: () => ({ effect: "allow" as const }) }];
      },
    })),
    /Policy provider id must not be empty/,
  );
});

test("AdapterHost unmount removes routing state even when adapter stop fails", async () => {
  const host = new AdapterHost();
  await host.mount(makeAdapter("stop-error", "1", {
    stop() {
      throw new Error("external stop failed");
    },
  }));
  await assert.rejects(host.unmount("stop-error"), /external stop failed/);
  assert.equal(host.list().length, 0);
  assert.equal(host.registry.has("stop-error"), false);
});


test("Adapter capability helpers enforce minimum support levels", () => {
  const manifest = {
    adapterId: "capability-adapter",
    adapterVersion: "1",
    capabilities: {
      exact: { level: "exact" as const },
      compatible: { level: "compatible" as const },
      degraded: { level: "degraded" as const, notes: "limited" },
      unsupported: { level: "unsupported" as const, reason: "missing" },
    },
  };

  assert.equal(supportsCapability(manifest, "missing"), false);
  assert.equal(supportsCapability(manifest, "degraded"), true);
  assert.equal(supportsCapability(manifest, "compatible", "exact"), false);
  assert.equal(supportsCapability(manifest, "exact", "compatible"), true);

  assert.equal(requireCapability(manifest, "compatible").level, "compatible");
  assert.throws(
    () => requireCapability(manifest, "missing"),
    /does not satisfy capability missing/,
  );
  assert.throws(
    () => requireCapability(manifest, "degraded", "compatible"),
    /does not satisfy capability degraded at level compatible/,
  );
});


test("SelectionContext validates explicit scoped selection and preserves provenance", () => {
  const selection = createSelectionContext({
    selectionId: " sel-1 ",
    providerId: " hmi-a ",
    source: " hmi.canvas ",
    mode: "single",
    targets: [{
      targetId: " component-1 ",
      targetType: " industrial.hmi.component ",
      artifactId: " project-1 ",
      parentId: " screen-1 ",
      metadata: { role: "pump" },
    }],
    bounds: {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      coordinateSpace: " screen:overview ",
    },
    timestamp: " 2026-09-18T01:00:00Z ",
    metadata: { gesture: "click" },
  });

  assert.equal(selection.selectionId, "sel-1");
  assert.equal(selection.providerId, "hmi-a");
  assert.equal(selection.source, "hmi.canvas");
  assert.equal(selection.targets[0]?.targetId, "component-1");
  assert.equal(selection.targets[0]?.targetType, "industrial.hmi.component");
  assert.equal(selection.targets[0]?.artifactId, "project-1");
  assert.equal(selection.bounds?.coordinateSpace, "screen:overview");
  assert.deepEqual(selectedTargetIds(selection), ["component-1"]);
  assert.equal(Object.isFrozen(selection), true);
  assert.equal(Object.isFrozen(selection.targets), true);
  assert.equal(Object.isFrozen(selection.targets[0]), true);
  assert.equal(Object.isFrozen(selection.bounds), true);
  assert.equal(Object.isFrozen(selection.metadata), true);
  assertSelectionProvider(selection, "hmi-a");
  assert.throws(
    () => assertSelectionProvider(selection, "hmi-b"),
    /Selection provider mismatch/,
  );
});

test("SelectionContext fails closed on invalid modes, identities and bounds", () => {
  const target = { targetId: "component", targetType: "component" };
  const base = {
    selectionId: "selection",
    providerId: "provider",
    source: "canvas",
  } as const;

  assert.throws(
    () => createSelectionContext({ ...base, selectionId: " ", mode: "single", targets: [target] }),
    /selectionId must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({ ...base, providerId: " ", mode: "single", targets: [target] }),
    /providerId must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({ ...base, source: " ", mode: "single", targets: [target] }),
    /source must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({ ...base, mode: "single", targets: [] }),
    /exactly one target/,
  );
  assert.throws(
    () => createSelectionContext({ ...base, mode: "single", targets: [target, target] }),
    /exactly one target/,
  );
  assert.throws(
    () => createSelectionContext({ ...base, mode: "multiple", targets: [] }),
    /at least one target/,
  );
  assert.throws(
    () => createSelectionContext({ ...base, mode: "region", targets: [] }),
    /requires bounds/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "single",
      targets: [{ targetId: " ", targetType: "component" }],
    }),
    /targetId must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "single",
      targets: [{ targetId: "c", targetType: " " }],
    }),
    /targetType must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "single",
      targets: [{ targetId: "c", targetType: "component", artifactId: " " }],
    }),
    /artifactId must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "single",
      targets: [{ targetId: "c", targetType: "component", parentId: " " }],
    }),
    /parentId must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "region",
      targets: [],
      bounds: { x: Number.NaN, y: 0, width: 1, height: 1 },
    }),
    /bounds x must be finite/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "region",
      targets: [],
      bounds: { x: 0, y: 0, width: -1, height: 1 },
    }),
    /width\/height must not be negative/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "region",
      targets: [],
      bounds: { x: 0, y: 0, width: 1, height: 1, coordinateSpace: " " },
    }),
    /coordinateSpace must be a non-empty string/,
  );
  assert.throws(
    () => createSelectionContext({
      ...base,
      mode: "single",
      targets: [target],
      timestamp: " ",
    }),
    /timestamp must be a non-empty string/,
  );
  assert.throws(() => assertSelectionProvider(
    createSelectionContext({ ...base, mode: "single", targets: [target] }),
    " ",
  ), /providerId must be a non-empty string/);
});

test("Adapter Context providers receive the explicit current Selection snapshot", async () => {
  const selection = createSelectionContext({
    selectionId: "sel-current",
    providerId: "selection-adapter",
    source: "canvas",
    mode: "single",
    targets: [{ targetId: "component-1", targetType: "component" }],
  });
  let observedSelection: unknown;
  const host = new AdapterHost();
  await host.mount(makeAdapter("selection-adapter", "1", {
    context() {
      return [{
        id: "selection",
        async build(request) {
          observedSelection = request.selection;
          return {
            providerId: "selection-adapter",
            kind: "selection",
            content: request.selection,
          };
        },
      }];
    },
  }));

  const fragments = await host.buildContext(
    { purpose: "scoped-edit", selection },
    { adapterIds: ["selection-adapter"] },
  );
  assert.equal(observedSelection, selection);
  assert.equal(fragments[0]?.content, selection);
});
