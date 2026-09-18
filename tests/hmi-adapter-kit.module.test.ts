import assert from "node:assert/strict";
import test from "node:test";

import {
  HMI_CAPABILITIES,
  HMI_PROJECT_ARTIFACT_TYPE,
  HMI_SELECTION_CONTEXT_KIND,
  HMI_SCREEN_TARGET_TYPE,
  HMI_COMPONENT_TARGET_TYPE,
  createHmiCapabilityManifest,
  createHmiTools,
  exactHmiCapabilities,
  hmiProjectRef,
  hmiComponentSelection,
  hmiMultiComponentSelection,
  hmiRegionSelection,
  hmiScreenSelection,
  hmiSelectionContextFragment,
  isHmiProjectArtifact,
} from "../packages/hmi-adapter-kit/src/index.ts";

test("HMI helpers validate project refs and rich capability manifests", () => {
  assert.throws(() => hmiProjectRef(""), /id must not be empty/);
  const ref = hmiProjectRef("project:1");
  assert.deepEqual(ref, { id: "project:1", type: HMI_PROJECT_ARTIFACT_TYPE, provider: undefined, version: undefined });
  assert.equal(isHmiProjectArtifact(ref), true);
  assert.equal(isHmiProjectArtifact({ id: "x", type: "other" }), false);

  assert.throws(
    () => createHmiCapabilityManifest({ adapterId: "", adapterVersion: "1" }),
    /adapter id must not be empty/i,
  );
  assert.throws(
    () => createHmiCapabilityManifest({ adapterId: "hmi", adapterVersion: "" }),
    /adapter version must not be empty/i,
  );

  const support = exactHmiCapabilities(HMI_CAPABILITIES.PROJECT_INSPECT, HMI_CAPABILITIES.PREVIEW);
  const manifest = createHmiCapabilityManifest({
    adapterId: "hmi",
    adapterVersion: "1",
    protocolVersion: "0.1",
    target: { vendor: "Vendor", product: "Product", version: "2" },
    support,
    extraCapabilities: { "vendor.custom": { level: "compatible", notes: "mapped" } },
    featureFlags: ["preview-v2"],
  });
  assert.equal(manifest.capabilities[HMI_CAPABILITIES.PROJECT_INSPECT]?.level, "exact");
  assert.equal(manifest.capabilities[HMI_CAPABILITIES.PREVIEW]?.level, "exact");
  assert.deepEqual(manifest.capabilities[HMI_CAPABILITIES.DEPLOY], {
    level: "unsupported",
    reason: "Capability was not declared by the adapter",
  });
  assert.equal(manifest.capabilities["vendor.custom"]?.level, "compatible");
  assert.deepEqual(manifest.featureFlags, ["preview-v2"]);
  assert.equal(manifest.target?.vendor, "Vendor");
  assert.deepEqual(exactHmiCapabilities(), {});
});

test("createHmiTools exposes every standard HMI tool with normalized valid inputs", async () => {
  const received = new Map<string, unknown>();
  const tools = createHmiTools({
    projectInspect(input) { received.set(HMI_CAPABILITIES.PROJECT_INSPECT, input); return "inspect"; },
    screenCreate(input) { received.set(HMI_CAPABILITIES.SCREEN_CREATE, input); return "create"; },
    screenUpdate(input) { received.set(HMI_CAPABILITIES.SCREEN_UPDATE, input); return "screen-update"; },
    componentAdd(input) { received.set(HMI_CAPABILITIES.COMPONENT_ADD, input); return "component-add"; },
    componentUpdate(input) { received.set(HMI_CAPABILITIES.COMPONENT_UPDATE, input); return "component-update"; },
    bindingCreate(input) { received.set(HMI_CAPABILITIES.BINDING_CREATE, input); return "binding"; },
    projectValidate(input) { received.set(HMI_CAPABILITIES.PROJECT_VALIDATE, input); return "validate"; },
    preview(input) { received.set(HMI_CAPABILITIES.PREVIEW, input); return "preview"; },
    deploy(input) { received.set(HMI_CAPABILITIES.DEPLOY, input); return "deploy"; },
  });

  assert.equal(tools.length, 9);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const cases: Array<[string, unknown, unknown]> = [
    [HMI_CAPABILITIES.PROJECT_INSPECT, { projectId: " p " }, { projectId: "p" }],
    [HMI_CAPABILITIES.SCREEN_CREATE, { projectId: " p ", name: " Main ", template: " Blank " }, { projectId: "p", name: "Main", template: "Blank" }],
    [HMI_CAPABILITIES.SCREEN_UPDATE, { projectId: " p ", screenId: " s ", patch: { title: "x" } }, { projectId: "p", screenId: "s", patch: { title: "x" } }],
    [HMI_CAPABILITIES.COMPONENT_ADD, { projectId: "p", screenId: "s", component: { type: "button" } }, { projectId: "p", screenId: "s", component: { type: "button" } }],
    [HMI_CAPABILITIES.COMPONENT_UPDATE, { projectId: "p", screenId: "s", componentId: " c ", patch: { x: 1 } }, { projectId: "p", screenId: "s", componentId: "c", patch: { x: 1 } }],
    [HMI_CAPABILITIES.BINDING_CREATE, { projectId: "p", screenId: "s", componentId: "c", property: " value ", binding: { source: "tag:1" } }, { projectId: "p", screenId: "s", componentId: "c", property: "value", binding: { source: "tag:1" } }],
    [HMI_CAPABILITIES.PROJECT_VALIDATE, { projectId: " p " }, { projectId: "p" }],
    [HMI_CAPABILITIES.PREVIEW, { projectId: "p", screenId: " s " }, { projectId: "p", screenId: "s" }],
    [HMI_CAPABILITIES.DEPLOY, { projectId: "p", target: " runtime " }, { projectId: "p", target: "runtime" }],
  ];

  for (const [name, raw, expected] of cases) {
    const tool = byName.get(name);
    assert.ok(tool, `missing tool ${name}`);
    const parsed = tool.validateInput?.(raw);
    assert.deepEqual(parsed, expected);
    await tool.execute(parsed, { actorId: "tester" });
    assert.deepEqual(received.get(name), expected);
  }

  assert.equal(byName.get(HMI_CAPABILITIES.PROJECT_INSPECT)?.idempotent, true);
  assert.equal(byName.get(HMI_CAPABILITIES.PROJECT_VALIDATE)?.idempotent, true);
  assert.equal(byName.get(HMI_CAPABILITIES.SCREEN_CREATE)?.risk, "L2");
  assert.equal(byName.get(HMI_CAPABILITIES.PREVIEW)?.effect, "local-write");
  assert.equal(byName.get(HMI_CAPABILITIES.DEPLOY)?.effect, "deploy");
});

test("createHmiTools omits absent handlers and covers optional fields", () => {
  assert.deepEqual(createHmiTools({}), []);

  const tools = createHmiTools({ screenCreate: () => null, preview: () => null, deploy: () => null });
  const screenCreate = tools.find((tool) => tool.name === HMI_CAPABILITIES.SCREEN_CREATE)!;
  const preview = tools.find((tool) => tool.name === HMI_CAPABILITIES.PREVIEW)!;
  const deploy = tools.find((tool) => tool.name === HMI_CAPABILITIES.DEPLOY)!;
  assert.deepEqual(screenCreate.validateInput?.({ projectId: "p", name: "n" }), { projectId: "p", name: "n", template: undefined });
  assert.deepEqual(preview.validateInput?.({ projectId: "p" }), { projectId: "p", screenId: undefined });
  assert.deepEqual(deploy.validateInput?.({ projectId: "p" }), { projectId: "p", target: undefined });
});

test("HMI tool validators fail closed for malformed scalar and structured input", () => {
  const tools = createHmiTools({
    projectInspect: () => null,
    screenCreate: () => null,
    screenUpdate: () => null,
    componentAdd: () => null,
    componentUpdate: () => null,
    bindingCreate: () => null,
    preview: () => null,
    deploy: () => null,
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.throws(() => byName.get(HMI_CAPABILITIES.PROJECT_INSPECT)?.validateInput?.(null), /Expected an object input/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.PROJECT_INSPECT)?.validateInput?.([]), /Expected an object input/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.PROJECT_INSPECT)?.validateInput?.({ projectId: " " }), /projectId to be a non-empty string/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.SCREEN_CREATE)?.validateInput?.({ projectId: "p", name: 3 }), /name to be a non-empty string/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.SCREEN_CREATE)?.validateInput?.({ projectId: "p", name: "n", template: " " }), /template to be a non-empty string/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.SCREEN_UPDATE)?.validateInput?.({ projectId: "p", screenId: "s", patch: [] }), /patch to be an object/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.COMPONENT_ADD)?.validateInput?.({ projectId: "p", screenId: "s", component: null }), /component to be an object/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.COMPONENT_UPDATE)?.validateInput?.({ projectId: "p", screenId: "s", componentId: "c", patch: "x" }), /patch to be an object/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.BINDING_CREATE)?.validateInput?.({ projectId: "p", screenId: "s", componentId: "c", property: "x", binding: [] }), /binding to be an object/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.PREVIEW)?.validateInput?.({ projectId: "p", screenId: 4 }), /screenId to be a non-empty string/);
  assert.throws(() => byName.get(HMI_CAPABILITIES.DEPLOY)?.validateInput?.({ projectId: "p", target: " " }), /target to be a non-empty string/);
});


test("HMI selection helpers normalize screen, component, multi and region selection", () => {
  const component = hmiComponentSelection({
    selectionId: "sel-component",
    providerId: "hmi",
    projectId: " project:1 ",
    screenId: " screen:overview ",
    componentId: " pump-1 ",
    bounds: { x: 10, y: 20, width: 100, height: 50 },
  });
  assert.equal(component.source, "hmi.canvas");
  assert.equal(component.projectId, "project:1");
  assert.equal(component.screenId, "screen:overview");
  assert.equal(component.mode, "single");
  assert.deepEqual(component.targets[0], {
    targetId: "pump-1",
    targetType: HMI_COMPONENT_TARGET_TYPE,
    artifactId: "project:1",
    parentId: "screen:overview",
    metadata: undefined,
  });

  const multi = hmiMultiComponentSelection({
    selectionId: "sel-multi",
    providerId: "hmi",
    projectId: "project:1",
    screenId: "screen:overview",
    componentIds: ["pump-1", "valve-2"],
    source: "hmi.layers",
  });
  assert.equal(multi.mode, "multiple");
  assert.equal(multi.source, "hmi.layers");
  assert.deepEqual(multi.targets.map((target) => target.targetId), ["pump-1", "valve-2"]);

  const region = hmiRegionSelection({
    selectionId: "sel-region",
    providerId: "hmi",
    projectId: "project:1",
    screenId: "screen:overview",
    componentIds: ["pump-1", "valve-2"],
    bounds: {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      coordinateSpace: "screen:overview",
    },
  });
  assert.equal(region.mode, "region");
  assert.equal(region.bounds?.coordinateSpace, "screen:overview");

  const blankRegion = hmiRegionSelection({
    selectionId: "sel-blank-region",
    providerId: "hmi",
    projectId: "project:1",
    screenId: "screen:overview",
    bounds: { x: 400, y: 100, width: 200, height: 120 },
  });
  assert.deepEqual(blankRegion.targets, []);

  const screen = hmiScreenSelection({
    selectionId: "sel-screen",
    providerId: "hmi",
    projectId: "project:1",
    screenId: "screen:overview",
  });
  assert.equal(screen.targets[0]?.targetType, HMI_SCREEN_TARGET_TYPE);
  assert.equal(screen.targets[0]?.targetId, "screen:overview");

  const fragment = hmiSelectionContextFragment(region);
  assert.equal(fragment.kind, HMI_SELECTION_CONTEXT_KIND);
  assert.equal(fragment.providerId, "hmi");
  assert.equal(fragment.content, region);
  assert.deepEqual(fragment.metadata, {
    projectId: "project:1",
    screenId: "screen:overview",
    selectionId: "sel-region",
    mode: "region",
  });
});

test("HMI selection helpers fail closed on missing engineering identities", () => {
  assert.throws(
    () => hmiComponentSelection({
      selectionId: "sel",
      providerId: "hmi",
      projectId: "",
      screenId: "screen",
      componentId: "component",
    }),
    /projectId must be a non-empty string/,
  );
  assert.throws(
    () => hmiComponentSelection({
      selectionId: "sel",
      providerId: "hmi",
      projectId: "project",
      screenId: "",
      componentId: "component",
    }),
    /screenId must be a non-empty string/,
  );
  assert.throws(
    () => hmiComponentSelection({
      selectionId: "sel",
      providerId: "hmi",
      projectId: "project",
      screenId: "screen",
      componentId: "",
    }),
    /componentId must be a non-empty string/,
  );
  assert.throws(
    () => hmiMultiComponentSelection({
      selectionId: "sel",
      providerId: "hmi",
      projectId: "project",
      screenId: "screen",
      componentIds: [],
    }),
    /at least one target/,
  );
  assert.throws(
    () => hmiRegionSelection({
      selectionId: "sel",
      providerId: "hmi",
      projectId: "project",
      screenId: "screen",
      bounds: { x: 0, y: 0, width: -1, height: 10 },
    }),
    /width\/height must not be negative/,
  );
});

test("HMI capability manifest exposes selection context as a standard capability", () => {
  const manifest = createHmiCapabilityManifest({
    adapterId: "hmi",
    adapterVersion: "1",
    support: exactHmiCapabilities(HMI_CAPABILITIES.SELECTION_CONTEXT),
  });
  assert.equal(
    manifest.capabilities[HMI_CAPABILITIES.SELECTION_CONTEXT]?.level,
    "exact",
  );
});
