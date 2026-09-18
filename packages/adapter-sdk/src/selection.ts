export type SelectionMode = "single" | "multiple" | "region";

export interface SelectionBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Product-defined coordinate space, for example `screen:overview`.
   * Coordinates are contextual evidence only; they are not authoritative
   * engineering target identity.
   */
  readonly coordinateSpace?: string;
}

export interface SelectionTarget {
  /** Stable product engineering object identity. */
  readonly targetId: string;
  /** Vendor-neutral or adapter-defined semantic target type. */
  readonly targetType: string;
  /** Optional durable Artifact identity containing the target. */
  readonly artifactId?: string;
  /** Optional stable parent engineering object identity. */
  readonly parentId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SelectionContext {
  /** Stable identity for this snapshot, not for a long-lived mutable selection. */
  readonly selectionId: string;
  /** Authoritative Adapter/provider scope for every target in this snapshot. */
  readonly providerId: string;
  /** UI/application source, for example `hmi.canvas`. */
  readonly source: string;
  readonly mode: SelectionMode;
  readonly targets: readonly SelectionTarget[];
  /**
   * Optional region evidence. Required for `region` mode.
   * Axrail must not perform hit testing from these coordinates.
   */
  readonly bounds?: SelectionBounds;
  readonly timestamp?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SelectionContextInput extends SelectionContext {}

export function createSelectionContext(
  input: SelectionContextInput,
): SelectionContext {
  const selectionId = requiredText(input.selectionId, "selectionId");
  const providerId = requiredText(input.providerId, "providerId");
  const source = requiredText(input.source, "source");

  if (input.mode === "single" && input.targets.length !== 1) {
    throw new Error("Single selection requires exactly one target");
  }
  if (input.mode === "multiple" && input.targets.length < 1) {
    throw new Error("Multiple selection requires at least one target");
  }
  if (input.mode === "region" && !input.bounds) {
    throw new Error("Region selection requires bounds");
  }

  const targets = Object.freeze(
    input.targets.map((target) =>
      Object.freeze({
        ...target,
        targetId: requiredText(target.targetId, "targetId"),
        targetType: requiredText(target.targetType, "targetType"),
        artifactId: optionalText(target.artifactId, "artifactId"),
        parentId: optionalText(target.parentId, "parentId"),
        metadata: target.metadata
          ? Object.freeze({ ...target.metadata })
          : undefined,
      }),
    ),
  );

  const bounds = input.bounds
    ? freezeBounds(input.bounds)
    : undefined;

  return Object.freeze({
    selectionId,
    providerId,
    source,
    mode: input.mode,
    targets,
    bounds,
    timestamp: optionalText(input.timestamp, "timestamp"),
    metadata: input.metadata
      ? Object.freeze({ ...input.metadata })
      : undefined,
  });
}

export function assertSelectionProvider(
  selection: SelectionContext,
  providerId: string,
): void {
  const expected = requiredText(providerId, "providerId");
  if (selection.providerId !== expected) {
    throw new Error(
      `Selection provider mismatch: expected ${expected}, got ${selection.providerId}`,
    );
  }
}

export function selectedTargetIds(
  selection: SelectionContext,
): readonly string[] {
  return selection.targets.map((target) => target.targetId);
}

function freezeBounds(bounds: SelectionBounds): SelectionBounds {
  for (const [key, value] of [
    ["x", bounds.x],
    ["y", bounds.y],
    ["width", bounds.width],
    ["height", bounds.height],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new Error(`Selection bounds ${key} must be finite`);
    }
  }
  if (bounds.width < 0 || bounds.height < 0) {
    throw new Error("Selection bounds width/height must not be negative");
  }

  return Object.freeze({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    coordinateSpace: optionalText(
      bounds.coordinateSpace,
      "coordinateSpace",
    ),
  });
}

function requiredText(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Selection ${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(
  value: string | undefined,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field);
}
