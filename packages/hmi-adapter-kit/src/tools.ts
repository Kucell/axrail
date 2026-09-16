import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@axrail/tools";
import { HMI_CAPABILITIES } from "./capabilities.js";

export interface HmiProjectInput {
  readonly projectId: string;
}

export interface HmiScreenCreateInput extends HmiProjectInput {
  readonly name: string;
  readonly template?: string;
}

export interface HmiScreenUpdateInput extends HmiProjectInput {
  readonly screenId: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface HmiComponentAddInput extends HmiProjectInput {
  readonly screenId: string;
  readonly component: Readonly<Record<string, unknown>>;
}

export interface HmiComponentUpdateInput extends HmiProjectInput {
  readonly screenId: string;
  readonly componentId: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface HmiBindingCreateInput extends HmiProjectInput {
  readonly screenId: string;
  readonly componentId: string;
  readonly property: string;
  readonly binding: Readonly<Record<string, unknown>>;
}

export interface HmiPreviewInput extends HmiProjectInput {
  readonly screenId?: string;
}

export interface HmiDeployInput extends HmiProjectInput {
  readonly target?: string;
}

export type HmiToolHandler<TInput, TOutput = unknown> = (
  input: TInput,
  context: ToolExecutionContext,
) => Promise<TOutput> | TOutput;

export interface HmiToolHandlers {
  readonly projectInspect?: HmiToolHandler<HmiProjectInput>;
  readonly screenCreate?: HmiToolHandler<HmiScreenCreateInput>;
  readonly screenUpdate?: HmiToolHandler<HmiScreenUpdateInput>;
  readonly componentAdd?: HmiToolHandler<HmiComponentAddInput>;
  readonly componentUpdate?: HmiToolHandler<HmiComponentUpdateInput>;
  readonly bindingCreate?: HmiToolHandler<HmiBindingCreateInput>;
  readonly projectValidate?: HmiToolHandler<HmiProjectInput>;
  readonly preview?: HmiToolHandler<HmiPreviewInput>;
  readonly deploy?: HmiToolHandler<HmiDeployInput>;
}

export function createHmiTools(
  handlers: HmiToolHandlers,
): readonly ToolDefinition<unknown, unknown>[] {
  const tools: ToolDefinition<unknown, unknown>[] = [];

  if (handlers.projectInspect) {
    tools.push(tool({
      name: HMI_CAPABILITIES.PROJECT_INSPECT,
      description: "Inspect an HMI engineering project and return normalized project metadata.",
      risk: "L0",
      effect: "read",
      idempotent: true,
      inputSchema: projectSchema(),
      validateInput: parseProjectInput,
      execute: handlers.projectInspect,
    }));
  }

  if (handlers.screenCreate) {
    tools.push(tool({
      name: HMI_CAPABILITIES.SCREEN_CREATE,
      description: "Create a screen in an HMI engineering project.",
      risk: "L2",
      effect: "engineering-write",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          template: { type: "string", minLength: 1 },
        },
        required: ["projectId", "name"],
        additionalProperties: false,
      },
      validateInput: parseScreenCreateInput,
      execute: handlers.screenCreate,
    }));
  }

  if (handlers.screenUpdate) {
    tools.push(tool({
      name: HMI_CAPABILITIES.SCREEN_UPDATE,
      description: "Apply a structured patch to an HMI screen.",
      risk: "L2",
      effect: "engineering-write",
      inputSchema: patchTargetSchema("screenId"),
      validateInput: parseScreenUpdateInput,
      execute: handlers.screenUpdate,
    }));
  }

  if (handlers.componentAdd) {
    tools.push(tool({
      name: HMI_CAPABILITIES.COMPONENT_ADD,
      description: "Add a component to an HMI screen.",
      risk: "L2",
      effect: "engineering-write",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
          screenId: { type: "string", minLength: 1 },
          component: { type: "object" },
        },
        required: ["projectId", "screenId", "component"],
        additionalProperties: false,
      },
      validateInput: parseComponentAddInput,
      execute: handlers.componentAdd,
    }));
  }

  if (handlers.componentUpdate) {
    tools.push(tool({
      name: HMI_CAPABILITIES.COMPONENT_UPDATE,
      description: "Apply a structured patch to an HMI component.",
      risk: "L2",
      effect: "engineering-write",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
          screenId: { type: "string", minLength: 1 },
          componentId: { type: "string", minLength: 1 },
          patch: { type: "object" },
        },
        required: ["projectId", "screenId", "componentId", "patch"],
        additionalProperties: false,
      },
      validateInput: parseComponentUpdateInput,
      execute: handlers.componentUpdate,
    }));
  }

  if (handlers.bindingCreate) {
    tools.push(tool({
      name: HMI_CAPABILITIES.BINDING_CREATE,
      description: "Create a semantic data or capability binding for an HMI component property.",
      risk: "L2",
      effect: "engineering-write",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
          screenId: { type: "string", minLength: 1 },
          componentId: { type: "string", minLength: 1 },
          property: { type: "string", minLength: 1 },
          binding: { type: "object" },
        },
        required: ["projectId", "screenId", "componentId", "property", "binding"],
        additionalProperties: false,
      },
      validateInput: parseBindingCreateInput,
      execute: handlers.bindingCreate,
    }));
  }

  if (handlers.projectValidate) {
    tools.push(tool({
      name: HMI_CAPABILITIES.PROJECT_VALIDATE,
      description: "Validate an HMI engineering project without committing changes.",
      risk: "L0",
      effect: "read",
      idempotent: true,
      inputSchema: projectSchema(),
      validateInput: parseProjectInput,
      execute: handlers.projectValidate,
    }));
  }

  if (handlers.preview) {
    tools.push(tool({
      name: HMI_CAPABILITIES.PREVIEW,
      description: "Generate or refresh a local HMI preview.",
      risk: "L1",
      effect: "local-write",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
          screenId: { type: "string", minLength: 1 },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
      validateInput: parsePreviewInput,
      execute: handlers.preview,
    }));
  }

  if (handlers.deploy) {
    tools.push(tool({
      name: HMI_CAPABILITIES.DEPLOY,
      description: "Deploy an HMI engineering project to a runtime target.",
      risk: "L3",
      effect: "deploy",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", minLength: 1 },
          target: { type: "string", minLength: 1 },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
      validateInput: parseDeployInput,
      execute: handlers.deploy,
    }));
  }

  return tools;
}

interface TypedToolDefinition<TInput> extends ToolDefinition<TInput, unknown> {}

function tool<TInput>(definition: TypedToolDefinition<TInput>): ToolDefinition<unknown, unknown> {
  return definition as ToolDefinition<unknown, unknown>;
}

function projectSchema(): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    properties: { projectId: { type: "string", minLength: 1 } },
    required: ["projectId"],
    additionalProperties: false,
  };
}

function patchTargetSchema(targetKey: string): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    properties: {
      projectId: { type: "string", minLength: 1 },
      [targetKey]: { type: "string", minLength: 1 },
      patch: { type: "object" },
    },
    required: ["projectId", targetKey, "patch"],
    additionalProperties: false,
  };
}

function parseProjectInput(input: unknown): HmiProjectInput {
  const value = inputObject(input);
  return { projectId: requiredString(value, "projectId") };
}

function parseScreenCreateInput(input: unknown): HmiScreenCreateInput {
  const value = inputObject(input);
  return {
    projectId: requiredString(value, "projectId"),
    name: requiredString(value, "name"),
    template: optionalString(value, "template"),
  };
}

function parseScreenUpdateInput(input: unknown): HmiScreenUpdateInput {
  const value = inputObject(input);
  return {
    projectId: requiredString(value, "projectId"),
    screenId: requiredString(value, "screenId"),
    patch: requiredObject(value, "patch"),
  };
}

function parseComponentAddInput(input: unknown): HmiComponentAddInput {
  const value = inputObject(input);
  return {
    projectId: requiredString(value, "projectId"),
    screenId: requiredString(value, "screenId"),
    component: requiredObject(value, "component"),
  };
}

function parseComponentUpdateInput(input: unknown): HmiComponentUpdateInput {
  const value = inputObject(input);
  return {
    projectId: requiredString(value, "projectId"),
    screenId: requiredString(value, "screenId"),
    componentId: requiredString(value, "componentId"),
    patch: requiredObject(value, "patch"),
  };
}

function parseBindingCreateInput(input: unknown): HmiBindingCreateInput {
  const value = inputObject(input);
  return {
    projectId: requiredString(value, "projectId"),
    screenId: requiredString(value, "screenId"),
    componentId: requiredString(value, "componentId"),
    property: requiredString(value, "property"),
    binding: requiredObject(value, "binding"),
  };
}

function parsePreviewInput(input: unknown): HmiPreviewInput {
  const value = inputObject(input);
  return {
    projectId: requiredString(value, "projectId"),
    screenId: optionalString(value, "screenId"),
  };
}

function parseDeployInput(input: unknown): HmiDeployInput {
  const value = inputObject(input);
  return {
    projectId: requiredString(value, "projectId"),
    target: optionalString(value, "target"),
  };
}

function inputObject(input: unknown): Readonly<Record<string, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Expected an object input");
  }
  return input as Readonly<Record<string, unknown>>;
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`Expected ${key} to be a non-empty string`);
  }
  return candidate.trim();
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`Expected ${key} to be a non-empty string when provided`);
  }
  return candidate.trim();
}

function requiredObject(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const candidate = value[key];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Expected ${key} to be an object`);
  }
  return candidate as Readonly<Record<string, unknown>>;
}
