import assert from "node:assert/strict";
import test from "node:test";

import type { AgentModelProvider } from "../packages/agent/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";
import { ToolRegistry, ToolResolutionError } from "../packages/tools/src/index.ts";

test("ToolRegistry permits multiple providers for one semantic Tool and fails on ambiguity", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "hmi.project.inspect",
    providerId: "hmi-a",
    description: "Inspect HMI project",
    risk: "L0",
    effect: "read",
    execute: () => "A",
  });
  registry.register({
    name: "hmi.project.inspect",
    providerId: "hmi-b",
    description: "Inspect HMI project",
    risk: "L0",
    effect: "read",
    execute: () => "B",
  });

  assert.deepEqual(registry.providers("hmi.project.inspect"), ["hmi-a", "hmi-b"]);
  assert.throws(
    () => registry.get("hmi.project.inspect"),
    (error: unknown) =>
      error instanceof ToolResolutionError && error.code === "tool_provider_ambiguous",
  );
  assert.equal(
    registry.get("hmi.project.inspect", { providerIds: ["hmi-b"] }).providerId,
    "hmi-b",
  );
});

test("Harness mounts two adapters with the same semantic Tool and routes by provider scope", async () => {
  const harness = new HarnessRuntime();

  const adapter = (id: string) => ({
    id,
    version: "0.1.0",
    async capabilities() {
      return {
        adapterId: id,
        adapterVersion: "0.1.0",
        capabilities: { "hmi.project.inspect": { level: "exact" as const } },
      };
    },
    tools() {
      return [
        {
          name: "hmi.project.inspect",
          description: "Inspect HMI project",
          risk: "L0" as const,
          effect: "read" as const,
          execute() {
            return { provider: id };
          },
        },
      ];
    },
  });

  await harness.mountAdapter(adapter("hmi-a"));
  await harness.mountAdapter(adapter("hmi-b"));

  const ambiguous = await harness.tools.execute({
    id: "inspect-ambiguous",
    name: "hmi.project.inspect",
    input: {},
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error?.code, "tool_provider_ambiguous");

  const selected = await harness.tools.execute(
    {
      id: "inspect-b",
      name: "hmi.project.inspect",
      input: {},
    },
    { providerIds: ["hmi-b"] },
  );
  assert.equal(selected.ok, true);
  assert.deepEqual(selected.value, { provider: "hmi-b" });
});

test("HarnessAgent uses provider scope for model Tool discovery and execution", async () => {
  const harness = new HarnessRuntime();
  for (const id of ["hmi-a", "hmi-b"]) {
    await harness.mountAdapter({
      id,
      version: "0.1.0",
      async capabilities() {
        return {
          adapterId: id,
          adapterVersion: "0.1.0",
          capabilities: { "hmi.project.inspect": { level: "exact" as const } },
        };
      },
      tools() {
        return [
          {
            name: "hmi.project.inspect",
            description: "Inspect HMI project",
            risk: "L0" as const,
            effect: "read" as const,
            execute() {
              return { provider: id };
            },
          },
        ];
      },
    });
  }

  const model: AgentModelProvider = {
    id: "provider-routing-model",
    async complete(request) {
      assert.equal(request.tools.length, 1);
      const last = request.messages.at(-1);
      if (last?.role === "tool") {
        return { content: last.content, stopReason: "completed" };
      }
      return {
        toolCalls: [
          {
            id: "inspect-call",
            name: "hmi.project.inspect",
            input: {},
          },
        ],
        stopReason: "tool_calls",
      };
    },
  };

  const result = await harness.createAgent({ model }).run("Inspect the active HMI", {
    providerIds: ["hmi-b"],
  });

  assert.equal(result.status, "completed");
  assert.match(result.content ?? "", /hmi-b/);
});
