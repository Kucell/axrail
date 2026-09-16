import type {
  PolicyDecision,
  PolicyEffect,
  PolicyInput,
  PolicyObligation,
  PolicyProvider,
} from "./types.js";

export interface PolicyEngineOptions {
  readonly defaultEffect?: Extract<PolicyEffect, "allow" | "deny">;
}

export class PolicyEngine<TInput extends PolicyInput = PolicyInput> {
  private readonly providers = new Map<string, PolicyProvider<TInput>>();
  private readonly defaultEffect: Extract<PolicyEffect, "allow" | "deny">;

  constructor(options: PolicyEngineOptions = {}) {
    this.defaultEffect = options.defaultEffect ?? "deny";
  }

  register(provider: PolicyProvider<TInput>): void {
    if (!provider.id) throw new Error("Policy provider id must not be empty");
    if (this.providers.has(provider.id)) throw new Error(`Policy provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  list(): readonly PolicyProvider<TInput>[] {
    return [...this.providers.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async evaluate(input: TInput): Promise<PolicyDecision> {
    const decisions: Array<{ provider: string; decision: PolicyDecision }> = [];

    for (const provider of this.list()) {
      try {
        const decision = await provider.evaluate(input);
        if (decision) decisions.push({ provider: provider.id, decision });
      } catch (error) {
        return {
          effect: "deny",
          reason: `Policy provider ${provider.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          matchedRules: [provider.id],
        };
      }
    }

    if (decisions.length === 0) {
      return {
        effect: this.defaultEffect,
        reason: this.defaultEffect === "deny" ? "No policy rule allowed the operation" : undefined,
        matchedRules: [],
      };
    }

    const deny = decisions.find(({ decision }) => decision.effect === "deny");
    if (deny) return mergeDecision("deny", decisions, deny.decision.reason);

    const requiresApproval = decisions.some(({ decision }) => decision.effect === "require-approval");
    if (requiresApproval) return mergeDecision("require-approval", decisions);

    return mergeDecision("allow", decisions);
  }
}

function mergeDecision(
  effect: PolicyEffect,
  decisions: ReadonlyArray<{ provider: string; decision: PolicyDecision }>,
  reason?: string,
): PolicyDecision {
  const obligations: PolicyObligation[] = [];
  const matchedRules = new Set<string>();

  for (const { provider, decision } of decisions) {
    if (decision.effect !== effect && effect === "deny") continue;
    matchedRules.add(provider);
    for (const rule of decision.matchedRules ?? []) matchedRules.add(rule);
    obligations.push(...(decision.obligations ?? []));
  }

  return {
    effect,
    reason,
    obligations,
    matchedRules: [...matchedRules],
  };
}
