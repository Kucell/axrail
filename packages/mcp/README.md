# @axrail/mcp

Governed Model Context Protocol integration for Axrail.

Remote MCP tools are normalized into Axrail `ToolDefinition`s and still pass through ToolRuntime risk, policy, approval, timeout, and audit boundaries.

## Official MCP TypeScript SDK v2

Axrail integrates with the stable `@modelcontextprotocol/client` v2 line for the 2026-07-28 MCP specification.

```ts
const client = await connectMcpHttp({
  serverId: "plant-tools",
  url: "https://example.com/mcp",
})

const bridge = new McpToolBridge(toolRegistry, {
  client,
  trustedServer: false,
})

await bridge.sync()
```

Local stdio servers are supported through `connectMcpStdio`.

MCP tool annotations are hints. Axrail does not allow annotations from an untrusted server to lower a tool's risk classification.
