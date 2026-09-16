import type {
  CapabilityManifest,
  CapabilitySupport,
} from "@axrail/adapter-sdk";
import {
  HMI_STANDARD_CAPABILITIES,
  type HmiCapabilityName,
} from "./capabilities.js";

export interface HmiCapabilityManifestOptions {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly protocolVersion?: string;
  readonly target?: CapabilityManifest["target"];
  readonly support?: Partial<Record<HmiCapabilityName, CapabilitySupport>>;
  readonly extraCapabilities?: Readonly<Record<string, CapabilitySupport>>;
  readonly featureFlags?: readonly string[];
}

export function createHmiCapabilityManifest(
  options: HmiCapabilityManifestOptions,
): CapabilityManifest {
  if (!options.adapterId) throw new Error("HMI adapter id must not be empty");
  if (!options.adapterVersion) throw new Error("HMI adapter version must not be empty");

  const capabilities: Record<string, CapabilitySupport> = {};
  for (const name of HMI_STANDARD_CAPABILITIES) {
    capabilities[name] = options.support?.[name] ?? {
      level: "unsupported",
      reason: "Capability was not declared by the adapter",
    };
  }

  Object.assign(capabilities, options.extraCapabilities ?? {});

  return {
    adapterId: options.adapterId,
    adapterVersion: options.adapterVersion,
    protocolVersion: options.protocolVersion,
    target: options.target,
    capabilities,
    featureFlags: options.featureFlags,
  };
}

export function exactHmiCapabilities(
  ...names: readonly HmiCapabilityName[]
): Partial<Record<HmiCapabilityName, CapabilitySupport>> {
  return Object.fromEntries(
    names.map((name) => [name, { level: "exact" } as CapabilitySupport]),
  );
}
