export const HMI_CAPABILITIES = {
  PROJECT_ARTIFACT: "hmi.project.artifact",
  PROJECT_INSPECT: "hmi.project.inspect",
  SELECTION_CONTEXT: "hmi.selection.context",
  SCREEN_CREATE: "hmi.screen.create",
  SCREEN_UPDATE: "hmi.screen.update",
  COMPONENT_ADD: "hmi.component.add",
  COMPONENT_UPDATE: "hmi.component.update",
  BINDING_CREATE: "hmi.binding.create",
  PROJECT_VALIDATE: "hmi.project.validate",
  PREVIEW: "hmi.preview",
  DEPLOY: "hmi.deploy",
} as const;

export type HmiCapabilityName =
  (typeof HMI_CAPABILITIES)[keyof typeof HMI_CAPABILITIES];

export const HMI_STANDARD_CAPABILITIES = Object.freeze(
  Object.values(HMI_CAPABILITIES),
) as readonly HmiCapabilityName[];
