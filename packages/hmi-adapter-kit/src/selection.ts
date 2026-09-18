import {
  createSelectionContext,
  type AdapterContextFragment,
  type SelectionBounds,
  type SelectionContext,
  type SelectionTarget,
} from "@axrail/adapter-sdk";

export const HMI_SELECTION_CONTEXT_KIND = "hmi.selection.context";
export const HMI_SCREEN_TARGET_TYPE = "industrial.hmi.screen";
export const HMI_COMPONENT_TARGET_TYPE = "industrial.hmi.component";

export interface HmiSelectionContext extends SelectionContext {
  readonly projectId: string;
  readonly screenId: string;
}

export interface HmiSelectionBaseOptions {
  readonly selectionId: string;
  readonly providerId: string;
  readonly projectId: string;
  readonly screenId: string;
  readonly source?: string;
  readonly timestamp?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface HmiComponentSelectionOptions
  extends HmiSelectionBaseOptions {
  readonly componentId: string;
  readonly bounds?: SelectionBounds;
}

export interface HmiMultiComponentSelectionOptions
  extends HmiSelectionBaseOptions {
  readonly componentIds: readonly string[];
  readonly bounds?: SelectionBounds;
}

export interface HmiRegionSelectionOptions
  extends HmiSelectionBaseOptions {
  /** Resolved by the HMI product's hit testing. May be empty for a blank region. */
  readonly componentIds?: readonly string[];
  readonly bounds: SelectionBounds;
}

export function hmiComponentSelection(
  options: HmiComponentSelectionOptions,
): HmiSelectionContext {
  return createHmiSelection(options, "single", [
    componentTarget(options, options.componentId),
  ], options.bounds);
}

export function hmiMultiComponentSelection(
  options: HmiMultiComponentSelectionOptions,
): HmiSelectionContext {
  return createHmiSelection(
    options,
    "multiple",
    options.componentIds.map((id) => componentTarget(options, id)),
    options.bounds,
  );
}

export function hmiRegionSelection(
  options: HmiRegionSelectionOptions,
): HmiSelectionContext {
  return createHmiSelection(
    options,
    "region",
    (options.componentIds ?? []).map((id) => componentTarget(options, id)),
    options.bounds,
  );
}

export function hmiScreenSelection(
  options: HmiSelectionBaseOptions,
): HmiSelectionContext {
  return createHmiSelection(
    options,
    "single",
    [{
      targetId: requiredId(options.screenId, "screenId"),
      targetType: HMI_SCREEN_TARGET_TYPE,
      artifactId: requiredId(options.projectId, "projectId"),
    }],
  );
}

export function hmiSelectionContextFragment(
  selection: HmiSelectionContext,
): AdapterContextFragment {
  return {
    providerId: selection.providerId,
    kind: HMI_SELECTION_CONTEXT_KIND,
    content: selection,
    sensitive: false,
    metadata: {
      projectId: selection.projectId,
      screenId: selection.screenId,
      selectionId: selection.selectionId,
      mode: selection.mode,
    },
  };
}

function createHmiSelection(
  options: HmiSelectionBaseOptions,
  mode: SelectionContext["mode"],
  targets: readonly SelectionTarget[],
  bounds?: SelectionBounds,
): HmiSelectionContext {
  const projectId = requiredId(options.projectId, "projectId");
  const screenId = requiredId(options.screenId, "screenId");
  const selection = createSelectionContext({
    selectionId: options.selectionId,
    providerId: options.providerId,
    source: options.source ?? "hmi.canvas",
    mode,
    targets,
    bounds,
    timestamp: options.timestamp,
    metadata: options.metadata,
  });

  return Object.freeze({
    ...selection,
    projectId,
    screenId,
  });
}

function componentTarget(
  options: Pick<HmiSelectionBaseOptions, "projectId" | "screenId">,
  componentId: string,
): SelectionTarget {
  return {
    targetId: requiredId(componentId, "componentId"),
    targetType: HMI_COMPONENT_TARGET_TYPE,
    artifactId: requiredId(options.projectId, "projectId"),
    parentId: requiredId(options.screenId, "screenId"),
  };
}

function requiredId(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`HMI selection ${field} must be a non-empty string`);
  }
  return value.trim();
}
