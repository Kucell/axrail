import assert from "node:assert/strict";
import test from "node:test";

import type { AgentModelProvider } from "../packages/agent/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";
import {
  InteractionPluginHost,
  InteractionRuntime,
  ModelRegistry,
  assertModelCapabilities,
  modelProvenance,
} from "../packages/interaction-sdk/src/index.ts";
import type { AxrailAdapter } from "../packages/adapter-sdk/src/index.ts";

function provider(
  id: string,
  content = id,
  onComplete?: (metadata: Readonly<Record<string, unknown>> | undefined) => void,
): AgentModelProvider {
  return {
    id,
    async complete(request) {
      onComplete?.(request.metadata);
      return { content, stopReason: "completed" };
    },
  };
}

function adapter(id = "engineering"): AxrailAdapter {
  return {
    id,
    version: "1",
    async capabilities() {
      return {
        adapterId: id,
        adapterVersion: "1",
        capabilities: {},
      };
    },
  };
}

test("ModelRegistry validates descriptors and supports register/get/list/unregister", () => {
  const models = new ModelRegistry();
  const runtimeProvider = provider("runtime-a");

  const dispose = models.register({
    descriptor: {
      id: " model-a ",
      providerId: " vendor-a ",
      displayName: " Model A ",
      contextWindow: 128000,
      capabilities: {
        toolCalling: true,
        structuredOutput: false,
        reasoning: true,
      },
    },
    provider: runtimeProvider,
  });

  assert.equal(models.has("model-a"), true);
  assert.deepEqual(models.list(), [{
    id: "model-a",
    providerId: "vendor-a",
    displayName: "Model A",
    contextWindow: 128000,
    capabilities: {
      toolCalling: true,
      structuredOutput: false,
      vision: undefined,
      reasoning: true,
      streaming: undefined,
    },
  }]);
  assert.equal(Object.isFrozen(models.list()[0]), true);
  assert.equal(Object.isFrozen(models.list()[0]?.capabilities), true);

  const resolved = models.get(" model-a ");
  assert.equal(resolved.provider, runtimeProvider);
  assert.equal(resolved.descriptor.id, "model-a");

  assert.throws(
    () => models.register({
      descriptor: { id: "model-a", providerId: "vendor-b" },
      provider: provider("runtime-b"),
    }),
    /already registered/,
  );
  assert.throws(() => models.get("missing"), /not found/);
  assert.throws(() => models.has(" "), /must not be empty/);
  assert.throws(
    () => models.register({
      descriptor: { id: "", providerId: "vendor" },
      provider: runtimeProvider,
    }),
    /model id must not be empty/i,
  );
  assert.throws(
    () => models.register({
      descriptor: { id: "x", providerId: "" },
      provider: runtimeProvider,
    }),
    /providerId must not be empty/,
  );
  assert.throws(
    () => models.register({
      descriptor: { id: "x", providerId: "vendor", displayName: " " },
      provider: runtimeProvider,
    }),
    /displayName must not be empty/,
  );
  assert.throws(
    () => models.register({
      descriptor: { id: "x", providerId: "vendor", contextWindow: 0 },
      provider: runtimeProvider,
    }),
    /contextWindow must be a positive integer/,
  );
  assert.throws(
    () => models.register({
      descriptor: { id: "x", providerId: "vendor" },
      provider: {} as AgentModelProvider,
    }),
    /must implement complete/,
  );

  dispose();
  dispose();
  assert.equal(models.has("model-a"), false);

  models.register({
    descriptor: { id: "model-b", providerId: "vendor-b" },
    provider: provider("runtime-b"),
  });
  assert.equal(models.unregister("model-b"), true);
  assert.equal(models.unregister("model-b"), false);
});

test("ModelRegistry resolves explicit, default and singleton models deterministically", () => {
  const empty = new ModelRegistry();
  assert.throws(() => empty.resolve(), /No interaction model is registered/);

  const models = new ModelRegistry();
  const disposeA = models.register({
    descriptor: {
      id: "a",
      providerId: "vendor-a",
      capabilities: { toolCalling: true },
    },
    provider: provider("runtime-a"),
  });

  assert.equal(models.resolve().descriptor.id, "a");
  assert.equal(models.resolve({ modelId: "a" }).descriptor.id, "a");
  assert.equal(models.resolve({ defaultModelId: "a" }).descriptor.id, "a");

  models.register({
    descriptor: {
      id: "b",
      providerId: "vendor-b",
      capabilities: { reasoning: true },
    },
    provider: provider("runtime-b"),
  });

  assert.throws(
    () => models.resolve(),
    /model selection is required/,
  );
  assert.equal(models.resolve({ modelId: "b" }).descriptor.id, "b");
  assert.equal(models.resolve({ defaultModelId: "a" }).descriptor.id, "a");
  assert.throws(
    () => models.resolve({ modelId: "missing" }),
    /not found/,
  );
  assert.throws(
    () => models.resolve({ modelId: " " }),
    /model id must not be empty/,
  );
  assert.throws(
    () => models.resolve({ defaultModelId: " " }),
    /default model id must not be empty/,
  );

  disposeA();
  assert.equal(models.resolve().descriptor.id, "b");
});

test("Model capabilities fail closed unless explicitly declared true", () => {
  const descriptor = {
    id: "cap-model",
    providerId: "vendor",
    capabilities: {
      toolCalling: true,
      reasoning: false,
    },
  } as const;

  assert.doesNotThrow(() =>
    assertModelCapabilities(descriptor, ["toolCalling", "toolCalling"]),
  );
  assert.throws(
    () => assertModelCapabilities(descriptor, ["reasoning"]),
    /does not declare required capability: reasoning/,
  );
  assert.throws(
    () => assertModelCapabilities(descriptor, ["vision"]),
    /does not declare required capability: vision/,
  );

  const provenance = modelProvenance({
    descriptor,
    provider: provider("runtime-cap"),
  });
  assert.deepEqual(provenance, {
    modelId: "cap-model",
    modelProviderId: "vendor",
    runtimeProviderId: "runtime-cap",
  });

  assert.throws(
    () => modelProvenance({
      descriptor,
      provider: provider(" "),
    }),
    /Agent model provider id must not be empty/,
  );
});

test("InteractionPlugin model registration is reversible and rolls back on setup failure", async () => {
  const host = new InteractionPluginHost();

  await host.mount({
    id: "model-plugin",
    setup(api) {
      return api.registerModel({
        descriptor: {
          id: "plugin-model",
          providerId: "plugin-vendor",
          capabilities: { toolCalling: true },
        },
        provider: provider("plugin-runtime"),
      });
    },
  });

  assert.equal(host.models.has("plugin-model"), true);
  assert.deepEqual(host.snapshot().modelIds, ["plugin-model"]);

  assert.equal(await host.unmount("model-plugin"), true);
  assert.equal(host.models.has("plugin-model"), false);

  await host.mount({
    id: "owner",
    setup(api) {
      api.registerModel({
        descriptor: { id: "shared-model", providerId: "owner" },
        provider: provider("owner-runtime"),
      });
    },
  });

  await assert.rejects(
    host.mount({
      id: "broken",
      setup(api) {
        api.registerModel({
          descriptor: { id: "temporary-model", providerId: "broken" },
          provider: provider("temporary-runtime"),
        });
        api.registerModel({
          descriptor: { id: "shared-model", providerId: "broken" },
          provider: provider("duplicate-runtime"),
        });
      },
    }),
    /already registered/,
  );

  assert.equal(host.models.has("temporary-model"), false);
  assert.equal(host.models.has("shared-model"), true);
  assert.equal(host.has("broken"), false);
});

test("InteractionRuntime keeps constructor model compatibility and emits model provenance", async () => {
  const harness = new HarnessRuntime();
  await harness.adapters.mount(adapter("compat"));

  const metadataSeen: Array<Readonly<Record<string, unknown>> | undefined> = [];
  const events: string[] = [];
  const runtime = new InteractionRuntime({
    harness,
    model: provider("legacy-model", "legacy-result", (metadata) => {
      metadataSeen.push(metadata);
    }),
    idFactory: () => "int-legacy",
  });
  runtime.subscribe((event) => {
    events.push(event.type);
  });

  const result = await runtime.send({
    message: "inspect",
    providerId: "compat",
    sessionId: "session-model-compat",
  });

  assert.equal(result.agent.content, "legacy-result");
  assert.deepEqual(result.model, {
    modelId: "legacy-model",
    modelProviderId: "legacy-model",
    runtimeProviderId: "legacy-model",
  });
  assert.ok(events.includes("interaction.model.selected"));
  assert.equal(metadataSeen[0]?.interactionModelId, "legacy-model");
  assert.equal(metadataSeen[0]?.interactionModelProviderId, "legacy-model");
  assert.equal(
    metadataSeen[0]?.interactionModelRuntimeProviderId,
    "legacy-model",
  );

  const session = await harness.sessions.load("session-model-compat");
  assert.equal(session?.metadata?.interactionModelId, "legacy-model");
  assert.equal(
    session?.metadata?.interactionModelProviderId,
    "legacy-model",
  );
  assert.equal(
    session?.metadata?.interactionModelRuntimeProviderId,
    "legacy-model",
  );
});

test("InteractionRuntime switches models explicitly per turn and honors constructor default", async () => {
  const harness = new HarnessRuntime();
  await harness.adapters.mount(adapter("switch-hmi"));

  const models = new ModelRegistry();
  const calls: string[] = [];
  models.register({
    descriptor: {
      id: "fast",
      providerId: "vendor-fast",
      displayName: "Fast",
      capabilities: {
        toolCalling: true,
        reasoning: false,
      },
    },
    provider: provider("runtime-fast", "fast-result", () => {
      calls.push("fast");
    }),
  });
  models.register({
    descriptor: {
      id: "reasoning",
      providerId: "vendor-reasoning",
      displayName: "Reasoning",
      capabilities: {
        toolCalling: true,
        reasoning: true,
      },
    },
    provider: provider("runtime-reasoning", "reasoning-result", () => {
      calls.push("reasoning");
    }),
  });

  const runtime = new InteractionRuntime({
    harness,
    models,
    defaultModelId: "fast",
  });

  assert.deepEqual(
    runtime.models.list().map((model) => model.id),
    ["fast", "reasoning"],
  );

  const first = await runtime.send({
    message: "default",
    providerId: "switch-hmi",
    requiredModelCapabilities: ["toolCalling"],
  });
  assert.equal(first.model.modelId, "fast");
  assert.equal(first.agent.content, "fast-result");

  const second = await runtime.send({
    message: "hard problem",
    providerId: "switch-hmi",
    modelId: "reasoning",
    requiredModelCapabilities: ["toolCalling", "reasoning"],
  });
  assert.deepEqual(second.model, {
    modelId: "reasoning",
    modelProviderId: "vendor-reasoning",
    runtimeProviderId: "runtime-reasoning",
  });
  assert.equal(second.agent.content, "reasoning-result");
  assert.deepEqual(calls, ["fast", "reasoning"]);
});

test("InteractionRuntime fails before model execution for ambiguous, unknown or incapable selection", async () => {
  const harness = new HarnessRuntime();
  await harness.adapters.mount(adapter("fail-hmi"));

  const models = new ModelRegistry();
  let modelCalls = 0;
  models.register({
    descriptor: {
      id: "a",
      providerId: "vendor-a",
      capabilities: { toolCalling: true },
    },
    provider: provider("runtime-a", "a", () => {
      modelCalls += 1;
    }),
  });
  models.register({
    descriptor: {
      id: "b",
      providerId: "vendor-b",
      capabilities: { reasoning: false },
    },
    provider: provider("runtime-b", "b", () => {
      modelCalls += 1;
    }),
  });

  const runtime = new InteractionRuntime({ harness, models });

  await assert.rejects(
    runtime.send({ message: "ambiguous", providerId: "fail-hmi" }),
    /model selection is required/,
  );
  await assert.rejects(
    runtime.send({
      message: "unknown",
      providerId: "fail-hmi",
      modelId: "missing",
    }),
    /not found/,
  );
  await assert.rejects(
    runtime.send({
      message: "needs reasoning",
      providerId: "fail-hmi",
      modelId: "b",
      requiredModelCapabilities: ["reasoning"],
    }),
    /required capability: reasoning/,
  );
  assert.equal(modelCalls, 0);

  const noModels = new InteractionRuntime({ harness });
  await assert.rejects(
    noModels.send({ message: "no model", providerId: "fail-hmi" }),
    /No interaction model is registered/,
  );
});

test("InteractionRuntime can use plugin-registered model as configured default", async () => {
  const harness = new HarnessRuntime();
  await harness.adapters.mount(adapter("plugin-hmi"));

  const runtime = new InteractionRuntime({
    harness,
    defaultModelId: "plugin-default",
  });

  await runtime.mount({
    id: "private-model-plugin",
    setup(api) {
      return api.registerModel({
        descriptor: {
          id: "plugin-default",
          providerId: "private-vendor",
          capabilities: { toolCalling: true },
        },
        provider: provider(
          "private-runtime",
          "private-result",
        ),
      });
    },
  });

  const selectedEvents: unknown[] = [];
  runtime.subscribe((event) => {
    if (event.type === "interaction.model.selected") {
      selectedEvents.push(event.data);
    }
  });

  const result = await runtime.send({
    message: "use plugin model",
    providerId: "plugin-hmi",
  });

  assert.equal(result.agent.content, "private-result");
  assert.deepEqual(result.model, {
    modelId: "plugin-default",
    modelProviderId: "private-vendor",
    runtimeProviderId: "private-runtime",
  });
  assert.equal(selectedEvents.length, 1);

  await runtime.unmount("private-model-plugin");
  await assert.rejects(
    runtime.send({
      message: "model removed",
      providerId: "plugin-hmi",
    }),
    /not found/,
  );
});

test("InteractionRuntime validates constructor default model identity", () => {
  const harness = new HarnessRuntime();

  assert.throws(
    () => new InteractionRuntime({
      harness,
      defaultModelId: " ",
    }),
    /default model id must not be empty/,
  );
});
