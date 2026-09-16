import type { McpToolDescriptor } from "./types.js";

/**
 * Stable descriptor identity used to decide whether a same-name MCP Tool must
 * be re-registered and re-classified. This is intentionally not a security
 * signature; it is a deterministic change detector for JSON-compatible MCP
 * descriptors.
 */
export function mcpToolDescriptorFingerprint(descriptor: McpToolDescriptor): string {
  return stableJson(descriptor);
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("MCP Tool descriptor contains a non-finite number");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      if (typeof item === "function" || typeof item === "symbol" || typeof item === "bigint") {
        throw new TypeError(`Unsupported MCP Tool descriptor value at ${key}`);
      }
      output[key] = normalize(item);
    }
    return output;
  }
  throw new TypeError(`Unsupported MCP Tool descriptor value: ${typeof value}`);
}
