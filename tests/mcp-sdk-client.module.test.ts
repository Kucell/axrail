import assert from "node:assert/strict";
import test from "node:test";

import {
  McpSdkClientAdapter,
  McpSdkClientError,
  type McpSdkClientLike,
} from "../packages/mcp/src/index.ts";

function sdk(overrides: Partial<McpSdkClientLike> = {}): McpSdkClientLike {
  return {
    async listTools() { return { tools: [] }; },
    async callTool(params) { return { params }; },
    async close() {},
    ...overrides,
  };
}

test("McpSdkClientAdapter validates server identity and normalizes rich descriptors", async () => {
  assert.throws(() => new McpSdkClientAdapter("", sdk()), /serverId must not be empty/);
  const adapter = new McpSdkClientAdapter("server", sdk({
    async listTools() {
      return {
        tools: [{
          name: "tool",
          title: "Title",
          description: "Description",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          annotations: {
            title: "Annotation",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          _meta: { vendor: "x" },
        }, {
          name: "minimal",
          title: 3,
          description: null,
          annotations: "invalid",
          _meta: [],
        }],
      };
    },
  }));
  const tools = await adapter.listTools();
  assert.equal(tools[0]?.name, "tool");
  assert.equal(tools[0]?.annotations?.readOnlyHint, true);
  assert.deepEqual(tools[0]?.meta, { vendor: "x" });
  assert.equal(tools[1]?.title, undefined);
  assert.equal(tools[1]?.description, undefined);
  assert.equal(tools[1]?.annotations, undefined);
  assert.equal(tools[1]?.meta, undefined);
});

test("McpSdkClientAdapter rejects malformed descriptors and normalizes list failures", async () => {
  for (const value of [null, "tool"]) {
    const adapter = new McpSdkClientAdapter("s", sdk({ async listTools() { return { tools: [value] }; } }));
    await assert.rejects(adapter.listTools(), (error: unknown) => {
      assert.equal(error instanceof McpSdkClientError, true);
      assert.equal((error as McpSdkClientError).code, "invalid_tool_descriptor");
      return true;
    });
  }
  const missingName = new McpSdkClientAdapter("s", sdk({ async listTools() { return { tools: [{}] }; } }));
  await assert.rejects(missingName.listTools(), /missing name/);

  const failure = new McpSdkClientAdapter("s", sdk({ async listTools() { throw "offline"; } }));
  await assert.rejects(failure.listTools(), (error: unknown) => {
    assert.equal((error as McpSdkClientError).code, "list_tools_failed");
    assert.equal((error as Error).message, "offline");
    return true;
  });

  const original = new McpSdkClientError("custom", "already normalized");
  const existing = new McpSdkClientAdapter("s", sdk({ async listTools() { throw original; } }));
  await assert.rejects(existing.listTools(), (error: unknown) => error === original);
});

test("McpSdkClientAdapter normalizes arguments, signal forwarding and call failures", async () => {
  const calls: unknown[] = [];
  const client = sdk({
    async callTool(params, options) {
      calls.push({ params, options });
      return { ok: true };
    },
  });
  const adapter = new McpSdkClientAdapter("s", client);
  assert.deepEqual(await adapter.callTool("x", undefined), { ok: true });
  assert.deepEqual(await adapter.callTool("x", null), { ok: true });
  const signal = new AbortController().signal;
  assert.deepEqual(await adapter.callTool("x", { a: 1 }, { signal }), { ok: true });
  assert.deepEqual((calls[0] as any).params.arguments, {});
  assert.deepEqual((calls[1] as any).params.arguments, {});
  assert.equal((calls[2] as any).options.signal, signal);

  for (const invalid of [[], "x", 1]) {
    await assert.rejects(adapter.callTool("x", invalid), (error: unknown) => {
      assert.equal((error as McpSdkClientError).code, "invalid_tool_arguments");
      return true;
    });
  }

  const failed = new McpSdkClientAdapter("s", sdk({ async callTool() { throw "call failed"; } }));
  await assert.rejects(failed.callTool("x", {}), (error: unknown) => {
    assert.equal((error as McpSdkClientError).code, "call_tool_failed");
    assert.equal((error as Error).message, "call failed");
    return true;
  });
});

test("McpSdkClientAdapter reports remote tool text errors and fallback messages", async () => {
  const withText = new McpSdkClientAdapter("s", sdk({
    async callTool() {
      return {
        isError: true,
        content: [
          { type: "text", text: "first" },
          null,
          { type: "image", text: "ignored" },
          { type: "text", text: "second" },
        ],
      };
    },
  }));
  await assert.rejects(withText.callTool("x", {}), (error: unknown) => {
    assert.equal((error as McpSdkClientError).code, "remote_tool_error");
    assert.equal((error as Error).message, "first\nsecond");
    assert.ok((error as McpSdkClientError).details);
    return true;
  });

  const fallback = new McpSdkClientAdapter("s", sdk({ async callTool() { return { isError: true, content: "bad" }; } }));
  await assert.rejects(fallback.callTool("fallback", {}), /MCP tool fallback returned isError=true/);
});

test("McpSdkClientAdapter delegates close", async () => {
  let closed = false;
  const adapter = new McpSdkClientAdapter("s", sdk({ async close() { closed = true; } }));
  await adapter.close();
  assert.equal(closed, true);
});
