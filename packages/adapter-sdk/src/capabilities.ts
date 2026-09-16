import type { CapabilityManifest, CapabilitySupport } from "./types.js";

const SUPPORT_ORDER: Readonly<Record<CapabilitySupport["level"], number>> = {
  unsupported: 0,
  degraded: 1,
  compatible: 2,
  exact: 3,
};

export function supportsCapability(
  manifest: CapabilityManifest,
  capability: string,
  minimum: CapabilitySupport["level"] = "degraded",
): boolean {
  const support = manifest.capabilities[capability];
  if (!support) return false;
  return SUPPORT_ORDER[support.level] >= SUPPORT_ORDER[minimum];
}

export function requireCapability(
  manifest: CapabilityManifest,
  capability: string,
  minimum: CapabilitySupport["level"] = "degraded",
): CapabilitySupport {
  const support = manifest.capabilities[capability];
  if (!support || SUPPORT_ORDER[support.level] < SUPPORT_ORDER[minimum]) {
    throw new Error(`Adapter ${manifest.adapterId} does not satisfy capability ${capability} at level ${minimum}`);
  }
  return support;
}
