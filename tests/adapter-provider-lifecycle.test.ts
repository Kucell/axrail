import assert from "node:assert/strict";
import test from "node:test";

import { AdapterHost } from "../packages/adapter-sdk/src/index.ts";

function manifest(adapterId: string) {
  return {
    adapterId,
    adapterVersion: "0.1.0",
    capabilities: {},
  } as const;
}

test("AdapterHost scopes same-id validators by provider", async () => {
  const host = new AdapterHost();
  const ran: string[] = [];

  host.validation.register({
    id: "global",
    validate() {
      ran.push("global");
      return [];
    },
  });

  const adapterA = {
    id: "adapter-a",
    version: "0.1.0",
    async capabilities() {
      return manifest("adapter-a");
    },
    validators() {
      return [
        {
          id: "project-check",
          validate() {
            ran.push("a");
            return [];
          },
        },
      ];
    },
  };
  const adapterB = {
    id: "adapter-b",
    version: "0.1.0",
    async capabilities() {
      return manifest("adapter-b");
    },
    validators() {
      return [
        {
          id: "project-check",
          validate() {
            ran.push("b");
            return [];
          },
        },
      ];
    },
  };

  await host.mount(adapterA);
  await host.mount(adapterB);

  const result = await host.validation.validate(
    { projectId: "p-1" },
    { providerIds: ["adapter-a"] },
  );

  assert.equal(result.valid, true);
  assert.deepEqual(ran, ["global", "a"]);
  assert.deepEqual(result.validatorsRun, ["global", "adapter-a:project-check"]);
});

test("ValidationPipeline runs only global validators without provider scope", async () => {
  const host = new AdapterHost();
  const ran: string[] = [];

  host.validation.register({
    id: "global",
    validate() {
      ran.push("global");
      return [];
    },
  });

  await host.mount({
    id: "adapter-a",
    version: "0.1.0",
    async capabilities() {
      return manifest("adapter-a");
    },
    validators() {
      return [
        {
          id: "adapter-only",
          validate() {
            ran.push("adapter");
            return [];
          },
        },
      ];
    },
  });

  await host.validation.validate({});
  assert.deepEqual(ran, ["global"]);
});

test("AdapterHost removes executable providers before adapter stop begins", async () => {
  const host = new AdapterHost();
  let toolVisibleInsideStop = true;

  const adapter = {
    id: "drain-adapter",
    version: "0.1.0",
    async capabilities() {
      return manifest("drain-adapter");
    },
    tools() {
      return [
        {
          name: "drain.tool",
          description: "Tool used to verify drain ordering",
          risk: "L0" as const,
          effect: "read" as const,
          execute() {
            return "ok";
          },
        },
      ];
    },
    async stop() {
      toolVisibleInsideStop = host.tools.has("drain.tool", "drain-adapter");
    },
  };

  await host.mount(adapter);
  assert.equal(host.tools.has("drain.tool", "drain-adapter"), true);

  await host.unmount("drain-adapter");

  assert.equal(toolVisibleInsideStop, false);
  assert.equal(host.tools.has("drain.tool", "drain-adapter"), false);
  assert.equal(host.registry.has("drain-adapter"), false);
});
