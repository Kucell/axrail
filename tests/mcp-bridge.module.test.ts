import assert from "node:assert/strict";
import test from "node:test";

import {
  McpToolBridge,
  type McpToolDescriptor,
} from "../packages/mcp/src/index.ts";
import { ToolRegistry } from "../packages/tools/src/index.ts";

test("MCP bridge removes disappeared remote tools and dispose drains registrations", async () => {
  let descriptors: readonly McpToolDescriptor[] = [{ name: "status", title: "Status" }];
  const registry = new ToolRegistry();
  const bridge = new McpToolBridge(registry, {
    client: {
      serverId: "remote",
      async listTools() {
        return descriptors;
      },
      async callTool() {
        return { ok: true };
      },
    },
  });

  const first = await bridge.sync();
  const localName = first[0]?.localName;
  assert.ok(localName);
  assert.equal(registry.has(localName!, "remote"), true);

  descriptors = [];
  assert.deepEqual(await bridge.sync(), []);
  assert.equal(registry.has(localName!, "remote"), false);

  descriptors = [{ name: "again" }];
  await bridge.sync();
  assert.equal(bridge.list().length, 1);
  bridge.dispose();
  assert.equal(bridge.list().length, 0);
});

test("MCP bridge rejects empty remote names", async () => {
  const bridge = new McpToolBridge(new ToolRegistry(), {
    client: {
      serverId: "invalid",
      async listTools() {
        return [{ name: "" }];
      },
      async callTool() {
        return null;
      },
    },
  });

  await assert.rejects(bridge.sync(), /MCP tool name must not be empty/);
});

test("MCP bridge supports custom classification, description fallbacks and call context", async () => {
  const calls: Array<{ name: string; input: unknown; context: unknown }> = [];
  const registry = new ToolRegistry();
  const bridge = new McpToolBridge(registry, {
    namespace: "external",
    timeoutMs: 123,
    riskResolver(context) {
      assert.equal(context.serverId, "custom-server");
      assert.equal(context.trustedServer, false);
      return {
        risk: "L1",
        effect: "local-write",
        idempotent: true,
        reason: "custom",
      };
    },
    client: {
      serverId: "custom-server",
      async listTools() {
        return [
          { name: "by-title", title: "Title fallback" },
          { name: "by-default" },
        ];
      },
      async callTool(name, input, context) {
        calls.push({ name, input, context });
        return { name };
      },
    },
  });

  const synced = await bridge.sync();
  assert.equal(synced.length, 2);
  const titled = synced.find((tool) => tool.remoteName === "by-title")!;
  const fallback = synced.find((tool) => tool.remoteName === "by-default")!;

  const titledDefinition = registry.get(titled.localName, { providerId: "custom-server" });
  const fallbackDefinition = registry.get(fallback.localName, { providerId: "custom-server" });
  assert.equal(titledDefinition.description, "Title fallback");
  assert.match(fallbackDefinition.description, /MCP tool by-default from custom-server/);
  assert.equal(titledDefinition.timeoutMs, 123);
  assert.equal(titledDefinition.risk, "L1");
  assert.equal(titledDefinition.effect, "local-write");
  assert.equal(titledDefinition.idempotent, true);

  const controller = new AbortController();
  const result = await titledDefinition.execute(
    { value: 1 },
    {
      sessionId: "ses",
      transactionId: "tx",
      actorId: "actor",
      signal: controller.signal,
      metadata: { key: "value" },
    },
  );
  assert.deepEqual(result, { name: "by-title" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.input, { value: 1 });
  assert.deepEqual(calls[0]?.context, {
    signal: controller.signal,
    sessionId: "ses",
    transactionId: "tx",
    actorId: "actor",
    metadata: { key: "value" },
  });
});
