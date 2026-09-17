import assert from "node:assert/strict";
import test from "node:test";

import {
  AdapterContextRegistry,
  AdapterHost,
  AdapterRegistry,
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
  assert.throws(() => registry.unregister("adapter-a"), /Cannot unregister/);
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
