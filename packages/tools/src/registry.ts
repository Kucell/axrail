import type { ToolDefinition } from "./contract.js";

const DEFAULT_PROVIDER = "__axrail_default__";

export type ToolResolutionErrorCode =
  | "tool_not_found"
  | "tool_provider_unavailable"
  | "tool_provider_ambiguous";

export class ToolResolutionError extends Error {
  constructor(
    readonly code: ToolResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolResolutionError";
  }
}

export interface ToolResolutionOptions {
  readonly providerId?: string;
  readonly providerIds?: readonly string[];
}

/**
 * Registry of semantic Tools and their concrete providers.
 *
 * A semantic name may have multiple provider bindings (for example two HMI
 * adapters can both implement `hmi.screen.create`). Resolution must produce
 * exactly one provider; ambiguous resolution fails closed.
 */
export class ToolRegistry {
  private readonly tools = new Map<
    string,
    Map<string, ToolDefinition<unknown, unknown>>
  >();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): () => void {
    if (!tool.name) throw new Error("Tool name must not be empty");
    const providerKey = tool.providerId ?? DEFAULT_PROVIDER;
    const providers = this.tools.get(tool.name) ?? new Map();
    if (providers.has(providerKey)) {
      throw new Error(
        `Tool provider already registered: ${tool.name} (${displayProvider(providerKey)})`,
      );
    }
    providers.set(providerKey, tool as ToolDefinition<unknown, unknown>);
    this.tools.set(tool.name, providers);

    return () => {
      const current = this.tools.get(tool.name);
      if (!current) return;
      current.delete(providerKey);
      if (current.size === 0) this.tools.delete(tool.name);
    };
  }

  has(name: string, providerId?: string): boolean {
    const providers = this.tools.get(name);
    if (!providers) return false;
    if (providerId === undefined) return providers.size > 0;
    return providers.has(providerId) || providers.has(DEFAULT_PROVIDER);
  }

  get<TInput = unknown, TOutput = unknown>(
    name: string,
    options: ToolResolutionOptions = {},
  ): ToolDefinition<TInput, TOutput> {
    return this.resolve(name, options) as ToolDefinition<TInput, TOutput>;
  }

  resolve(
    name: string,
    options: ToolResolutionOptions = {},
  ): ToolDefinition<unknown, unknown> {
    const providers = this.tools.get(name);
    if (!providers?.size) {
      throw new ToolResolutionError("tool_not_found", `Tool not found: ${name}`);
    }

    if (options.providerId) {
      const exact = providers.get(options.providerId);
      if (exact) return exact;
      const fallback = providers.get(DEFAULT_PROVIDER);
      if (fallback) return fallback;
      throw new ToolResolutionError(
        "tool_provider_unavailable",
        `Tool ${name} is not provided by ${options.providerId}; available providers: ${providerList(providers)}`,
      );
    }

    const allowed = options.providerIds?.length
      ? new Set(options.providerIds)
      : undefined;
    const candidates = [...providers.entries()].filter(
      ([provider]) => provider === DEFAULT_PROVIDER || !allowed || allowed.has(provider),
    );

    if (candidates.length === 0) {
      throw new ToolResolutionError(
        "tool_provider_unavailable",
        `Tool ${name} has no provider in the active execution scope; available providers: ${providerList(providers)}`,
      );
    }
    if (candidates.length > 1) {
      throw new ToolResolutionError(
        "tool_provider_ambiguous",
        `Tool ${name} has multiple active providers: ${candidates
          .map(([provider]) => displayProvider(provider))
          .join(", ")}`,
      );
    }
    return candidates[0][1];
  }

  /**
   * Lists one resolved implementation per semantic Tool. If the active
   * provider scope cannot uniquely resolve a semantic Tool this method fails
   * instead of exposing an implementation chosen by registration order.
   */
  list(options: ToolResolutionOptions = {}): readonly ToolDefinition<unknown, unknown>[] {
    return [...this.tools.keys()]
      .sort()
      .map((name) => this.resolve(name, options));
  }

  providers(name: string): readonly string[] {
    const providers = this.tools.get(name);
    if (!providers) return [];
    return [...providers.keys()].map(displayProvider).sort();
  }
}

function providerList(
  providers: ReadonlyMap<string, ToolDefinition<unknown, unknown>>,
): string {
  return [...providers.keys()].map(displayProvider).sort().join(", ");
}

function displayProvider(provider: string): string {
  return provider === DEFAULT_PROVIDER ? "<default>" : provider;
}
