export interface ArtifactRef {
  readonly id: string;
  readonly type: string;
  readonly version?: string;
  readonly provider?: string;
}

export interface ArtifactLocator {
  readonly kind: string;
  readonly value: string;
}

export interface Artifact extends ArtifactRef {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly capabilities?: readonly string[];
  readonly locator?: ArtifactLocator;
}

export interface ArtifactSnapshot {
  readonly artifact: ArtifactRef;
  readonly version: string;
  readonly capturedAt: string;
  readonly content?: unknown;
  readonly contentRef?: string;
  readonly hash?: string;
}

export function artifactKey(ref: Pick<ArtifactRef, "id" | "provider">): string {
  return ref.provider ? `${ref.provider}:${ref.id}` : ref.id;
}
