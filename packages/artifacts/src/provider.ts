import type { Artifact, ArtifactRef, ArtifactSnapshot } from "./types.js";

export interface ArtifactProvider {
  readonly id: string;

  get(ref: ArtifactRef): Promise<Artifact>;
  exists(ref: ArtifactRef): Promise<boolean>;
  currentVersion(ref: ArtifactRef): Promise<string | undefined>;
  snapshot?(ref: ArtifactRef): Promise<ArtifactSnapshot>;
}

export class ArtifactVersionConflictError extends Error {
  readonly expected?: string;
  readonly actual?: string;

  constructor(expected?: string, actual?: string) {
    super(`Artifact version conflict: expected ${expected ?? "<none>"}, got ${actual ?? "<none>"}`);
    this.name = "ArtifactVersionConflictError";
    this.expected = expected;
    this.actual = actual;
  }
}

export async function assertArtifactVersion(
  provider: ArtifactProvider,
  ref: ArtifactRef,
  expected: string | undefined = ref.version,
): Promise<void> {
  if (expected === undefined) return;
  const actual = await provider.currentVersion(ref);
  if (actual !== expected) throw new ArtifactVersionConflictError(expected, actual);
}
