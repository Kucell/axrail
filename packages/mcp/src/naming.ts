export function mcpToolName(serverId: string, remoteName: string, namespace = "mcp"): string {
  return `${sanitize(namespace)}__${sanitize(serverId)}__${sanitize(remoteName)}`;
}

function sanitize(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
  if (!normalized) throw new Error("MCP namespace/name must contain at least one valid character");
  return normalized;
}
