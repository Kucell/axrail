import assert from "node:assert/strict";
import test from "node:test";

import {
  McpSdkClientAdapter,
  McpSdkClientError,
} from "../packages/mcp/src/index.ts";

test("MCP SDK adapter normalizes official tool descriptors", async () => {
  let closed = false;
  const client = new McpSdkClientAdapter("plant", {
    async listTools() {
      return {
        tools: [
          {
            name: "read_tag",
            title: "Read tag",
            description: "Read an industrial tag",
            inputSchema: {
              type: "object",
              properties: { tag: { type: "string" } },
              required: ["tag"],
            },
            outputSchema: { type: "object" },
            annotations: {
              readOnlyHint: true,
              idempotentHint: true,
            },
            _meta: { vendor: "demo" },
          },
        ],
      };
    },
    async callTool() {
      return { content: [{ type: "text", text: "42" }] };
    },
    async close() {
      closed = true;
    },
  });

  const tools = await client.listTools();

  assert.deepEqual(tools, [
    {
      name: "read_tag",
      title: "Read tag",
      description: "Read an industrial tag",
      inputSchema: {
        type: "object",
        properties: { tag: { type: "string" } },
        required: ["tag"],
      },
      outputSchema: { type: "object" },
      annotations: {
        title: undefined,
        readOnlyHint: true,
        destructiveHint: undefined,
        idempotentHint: true,
        openWorldHint: undefined,
      },
      meta: { vendor: "demo" },
    },
  ]);

  await client.close();
  assert.equal(closed, true);
});

test("MCP SDK adapter treats isError tool result as an execution error", async () => {
  const client = new McpSdkClientAdapter("plant", {
    async listTools() {
      return { tools: [] };
    },
    async callTool() {
      return {
        isError: true,
        content: [{ type: "text", text: "PLC rejected the operation" }],
      };
    },
    async close() {},
  });

  await assert.rejects(
    () => client.callTool("write_tag", { tag: "Motor.Start", value: true }),
    (error: unknown) =>
      error instanceof McpSdkClientError &&
      error.code === "remote_tool_error" &&
      /PLC rejected/.test(error.message),
  );
});

test("MCP SDK adapter rejects non-object tool arguments before transport", async () => {
  let called = false;
  const client = new McpSdkClientAdapter("plant", {
    async listTools() {
      return { tools: [] };
    },
    async callTool() {
      called = true;
      return {};
    },
    async close() {},
  });

  await assert.rejects(
    () => client.callTool("tool", "not-an-object"),
    (error: unknown) =>
      error instanceof McpSdkClientError && error.code === "invalid_tool_arguments",
  );
  assert.equal(called, false);
});
