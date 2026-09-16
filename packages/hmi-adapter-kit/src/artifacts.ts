import type { ArtifactRef } from "@axrail/artifacts";

export const HMI_PROJECT_ARTIFACT_TYPE = "industrial.hmi.project";

export interface HmiProjectRefOptions {
  readonly provider?: string;
  readonly version?: string;
}

export function hmiProjectRef(
  id: string,
  options: HmiProjectRefOptions = {},
): ArtifactRef {
  if (!id) throw new Error("HMI project artifact id must not be empty");
  return {
    id,
    type: HMI_PROJECT_ARTIFACT_TYPE,
    provider: options.provider,
    version: options.version,
  };
}

export function isHmiProjectArtifact(ref: ArtifactRef): boolean {
  return ref.type === HMI_PROJECT_ARTIFACT_TYPE;
}
