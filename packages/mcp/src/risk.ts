import type { ToolEffect, ToolRiskLevel } from "@axrail/tools";
import type {
  McpRiskContext,
  McpRiskResolver,
  McpToolClassification,
} from "./types.js";

export interface DefaultMcpRiskResolverOptions {
  readonly defaultRisk?: ToolRiskLevel;
  readonly defaultEffect?: ToolEffect;
}

export function createDefaultMcpRiskResolver(
  options: DefaultMcpRiskResolverOptions = {},
): McpRiskResolver {
  const defaultRisk = options.defaultRisk ?? "L2";
  const defaultEffect = options.defaultEffect ?? "engineering-write";

  return (context: McpRiskContext): McpToolClassification => {
    const annotations = context.descriptor.annotations;

    // MCP annotations are hints, not enforcement. Axrail only permits them to
    // reduce risk when the host has explicitly marked the server as trusted.
    if (context.trustedServer && annotations?.readOnlyHint === true) {
      return {
        risk: "L0",
        effect: "read",
        idempotent: true,
        reason: "Trusted MCP server declares readOnlyHint=true",
      };
    }

    return {
      risk: defaultRisk,
      effect: defaultEffect,
      idempotent:
        context.trustedServer && annotations?.idempotentHint === true
          ? true
          : undefined,
      reason: context.trustedServer
        ? "MCP tool did not provide a trusted read-only classification"
        : "MCP server annotations are not trusted for risk reduction",
    };
  };
}
