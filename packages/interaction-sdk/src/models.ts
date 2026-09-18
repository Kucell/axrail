import type { AgentModelProvider } from "@axrail/agent";

export type InteractionModelCapability =
  | "toolCalling"
  | "structuredOutput"
  | "vision"
  | "reasoning"
  | "streaming";

export interface InteractionModelCapabilities {
  readonly toolCalling?: boolean;
  readonly structuredOutput?: boolean;
  readonly vision?: boolean;
  readonly reasoning?: boolean;
  readonly streaming?: boolean;
}

export interface InteractionModelDescriptor {
  /** Stable logical model ID exposed to application/UI code. */
  readonly id: string;
  /** Descriptive model-provider identity, for example openai/deepseek/local. */
  readonly providerId: string;
  readonly displayName?: string;
  readonly contextWindow?: number;
  readonly capabilities?: InteractionModelCapabilities;
}

export interface InteractionModelRegistration {
  readonly descriptor: InteractionModelDescriptor;
  readonly provider: AgentModelProvider;
}

export interface ResolvedInteractionModel {
  readonly descriptor: InteractionModelDescriptor;
  readonly provider: AgentModelProvider;
}

export interface ResolveInteractionModelOptions {
  readonly modelId?: string;
  readonly defaultModelId?: string;
  readonly requiredCapabilities?: readonly InteractionModelCapability[];
}

export interface InteractionModelProvenance {
  readonly modelId: string;
  readonly modelProviderId: string;
  /** Concrete AgentModelProvider instance identity. */
  readonly runtimeProviderId: string;
}

interface ModelRecord {
  readonly descriptor: InteractionModelDescriptor;
  readonly provider: AgentModelProvider;
}

export class ModelRegistry {
  private readonly records = new Map<string, ModelRecord>();

  register(registration: InteractionModelRegistration): () => void {
    const descriptor = normalizeModelDescriptor(registration.descriptor);
    if (!registration.provider || typeof registration.provider.complete !== "function") {
      throw new Error("Interaction model provider must implement complete()");
    }
    if (this.records.has(descriptor.id)) {
      throw new Error(`Interaction model already registered: ${descriptor.id}`);
    }

    const record = Object.freeze({
      descriptor,
      provider: registration.provider,
    });
    this.records.set(descriptor.id, record);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.records.get(descriptor.id);
      if (current === record) this.records.delete(descriptor.id);
    };
  }

  unregister(modelId: string): boolean {
    return this.records.delete(requiredText(modelId, "Interaction model id"));
  }

  has(modelId: string): boolean {
    return this.records.has(requiredText(modelId, "Interaction model id"));
  }

  get(modelId: string): ResolvedInteractionModel {
    const id = requiredText(modelId, "Interaction model id");
    const record = this.records.get(id);
    if (!record) throw new Error(`Interaction model not found: ${id}`);
    return freezeResolved(record);
  }

  list(): readonly InteractionModelDescriptor[] {
    return Object.freeze(
      [...this.records.values()].map((record) => record.descriptor),
    );
  }

  resolve(options: ResolveInteractionModelOptions = {}): ResolvedInteractionModel {
    const explicitId = optionalText(options.modelId, "Interaction model id");
    const defaultId = optionalText(
      options.defaultModelId,
      "Interaction default model id",
    );

    let resolved: ResolvedInteractionModel;
    if (explicitId) {
      resolved = this.get(explicitId);
    } else if (defaultId) {
      resolved = this.get(defaultId);
    } else if (this.records.size === 1) {
      resolved = freezeResolved(this.records.values().next().value as ModelRecord);
    } else if (this.records.size === 0) {
      throw new Error("No interaction model is registered");
    } else {
      throw new Error(
        "Interaction model selection is required when multiple models are registered",
      );
    }

    assertModelCapabilities(
      resolved.descriptor,
      options.requiredCapabilities ?? [],
    );
    return resolved;
  }
}

export function assertModelCapabilities(
  descriptor: InteractionModelDescriptor,
  requiredCapabilities: readonly InteractionModelCapability[],
): void {
  for (const capability of new Set(requiredCapabilities)) {
    if (descriptor.capabilities?.[capability] !== true) {
      throw new Error(
        `Interaction model ${descriptor.id} does not declare required capability: ${capability}`,
      );
    }
  }
}

export function modelProvenance(
  model: ResolvedInteractionModel,
): InteractionModelProvenance {
  return Object.freeze({
    modelId: model.descriptor.id,
    modelProviderId: model.descriptor.providerId,
    runtimeProviderId: requiredText(
      model.provider.id,
      "Agent model provider id",
    ),
  });
}

function normalizeModelDescriptor(
  descriptor: InteractionModelDescriptor,
): InteractionModelDescriptor {
  const id = requiredText(descriptor.id, "Interaction model id");
  const providerId = requiredText(
    descriptor.providerId,
    "Interaction model providerId",
  );
  const displayName = optionalText(
    descriptor.displayName,
    "Interaction model displayName",
  );

  if (
    descriptor.contextWindow !== undefined &&
    (!Number.isInteger(descriptor.contextWindow) || descriptor.contextWindow < 1)
  ) {
    throw new Error(
      "Interaction model contextWindow must be a positive integer",
    );
  }

  const capabilities = descriptor.capabilities
    ? Object.freeze({
        toolCalling: descriptor.capabilities.toolCalling,
        structuredOutput: descriptor.capabilities.structuredOutput,
        vision: descriptor.capabilities.vision,
        reasoning: descriptor.capabilities.reasoning,
        streaming: descriptor.capabilities.streaming,
      })
    : undefined;

  return Object.freeze({
    id,
    providerId,
    displayName,
    contextWindow: descriptor.contextWindow,
    capabilities,
  });
}

function freezeResolved(record: ModelRecord): ResolvedInteractionModel {
  return Object.freeze({
    descriptor: record.descriptor,
    provider: record.provider,
  });
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
  return value.trim();
}

function optionalText(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, label);
}
