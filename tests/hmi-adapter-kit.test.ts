import assert from "node:assert/strict";
import test from "node:test";

import {
  HMI_CAPABILITIES,
  HMI_PROJECT_ARTIFACT_TYPE,
  createHmiCapabilityManifest,
  createHmiTools,
  exactHmiCapabilities,
  hmiProjectRef,
} from "../packages/hmi-adapter-kit/src/index.ts";

test("HMI project helper creates the canonical artifact reference", () => {
  const ref = hmiProjectRef("project:demo", {
    provider: "mock-hmi",
    version: "7",
  });

  assert.deepEqual(ref, {
    id: "project:demo",
    type: HMI_PROJECT_ARTIFACT_TYPE,
    provider: "mock-hmi",
    version: "7",
  });
});

test("HMI capability manifest makes undeclared standard capabilities explicit", () => {
  const manifest = createHmiCapabilityManifest({
    adapterId: "mock-hmi",
    adapterVersion: "0.1.0",
    support: exactHmiCapabilities(
      HMI_CAPABILITIES.PROJECT_ARTIFACT,
      HMI_CAPABILITIES.SCREEN_CREATE,
    ),
  });

  assert.deepEqual(manifest.capabilities[HMI_CAPABILITIES.PROJECT_ARTIFACT], {
    level: "exact",
  });
  assert.deepEqual(manifest.capabilities[HMI_CAPABILITIES.SCREEN_CREATE], {
    level: "exact",
  });
  assert.equal(
    manifest.capabilities[HMI_CAPABILITIES.DEPLOY]?.level,
    "unsupported",
  );
});

test("createHmiTools applies standard names, risk levels and normalized inputs", async () => {
  let received: unknown;
  const tools = createHmiTools({
    screenCreate(input) {
      received = input;
      return { created: true };
    },
    preview() {
      return { preview: true };
    },
    deploy() {
      return { deployed: true };
    },
  });

  const screenCreate = tools.find(
    (tool) => tool.name === HMI_CAPABILITIES.SCREEN_CREATE,
  );
  const preview = tools.find((tool) => tool.name === HMI_CAPABILITIES.PREVIEW);
  const deploy = tools.find((tool) => tool.name === HMI_CAPABILITIES.DEPLOY);

  assert.equal(screenCreate?.risk, "L2");
  assert.equal(screenCreate?.effect, "engineering-write");
  assert.equal(preview?.risk, "L1");
  assert.equal(deploy?.risk, "L3");

  const parsed = screenCreate?.validateInput?.({
    projectId: " project:demo ",
    name: " Robot Overview ",
  });
  await screenCreate?.execute(parsed, {});

  assert.deepEqual(received, {
    projectId: "project:demo",
    name: "Robot Overview",
    template: undefined,
  });
});

test("HMI tool validators reject malformed engineering inputs before execution", () => {
  const tools = createHmiTools({
    bindingCreate() {
      return null;
    },
  });
  const binding = tools[0];

  assert.throws(
    () =>
      binding.validateInput?.({
        projectId: "project:demo",
        screenId: "overview",
        componentId: "motor-1",
        property: "value",
        binding: "PLC1.DB1",
      }),
    /binding to be an object/,
  );
});
