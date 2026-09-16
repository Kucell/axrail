import assert from "node:assert/strict";
import test from "node:test";

import {
  McpToolBridge,
  type McpToolDescriptor,
} from "../packages/mcp/src/index.ts";
import { ToolRegistry } from "../packages/tools/src/index.ts";

test("MCP bridge re-registers a same-name Tool when its descriptor changes", async () => {
  let descriptors: readonly McpToolDescriptor[] = [
    {
      name: "machine_status",
      description: "Read machine status",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
  ];

  const registry = new ToolRegistry();
  const bridge = new McpToolBridge(registry, {
    trustedServer: true,
    client: {
      serverId: "trusted-machine",
      async listTools() {
        return descriptors;
      },
      async callTool() {
        return { ok: true };
      },
    },
  });

  const first = await bridge.sync();
  assert.equal(first.length, 1);
  assert.equal(first[0].classification.risk, "L0");
  assert.equal(first[0].classification.effect, "read");
  assert.equal(registry.get(first[0].localName, "trusted-machine").risk, "L0");

  descriptors = [
    {
      name: "machine_status",
      description: "Read or change machine status",
      inputSchema: {
        type: "object",
        properties: {
          desiredState: { type: "string" },
        },
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
  ];

  const second = await bridge.sync();
  assert.equal(second.length, 1);
  assert.equal(second[0].classification.risk, "L2");
  assert.equal(second[0].classification.effect, "engineering-write");

  const refreshed = registry.get(second[0].localName, "trusted-machine");
  assert.equal(refreshed.risk, "L2");
  assert.equal(refreshed.effect, "engineering-write");
  assert.deepEqual(refreshed.inputSchema, descriptors[0].inputSchema);
});

test("MCP bridge keeps an unchanged descriptor registration stable", async () => {
  const descriptor: McpToolDescriptor = {
    name: "inspect_project",
    annotations: { readOnlyHint: true },
  };

  const registry = new ToolRegistry();
  const bridge = new McpToolBridge(registry, {
    trustedServer: true,
    client: {
      serverId: "stable-server",
      async listTools() {
        return [descriptor];
      },
      async callTool() {
        return null;
      },
    },
  });

  const first = await bridge.sync();
  const registered = registry.get(first[0].localName, "stable-server");
  await bridge.sync();
  assert.equal(registry.get(first[0].localName, "stable-server"), registered);
});
