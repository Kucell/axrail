export type PolicyEffect = "allow" | "deny" | "require-approval";
export type PolicyRiskLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export interface PolicyPrincipal {
  readonly id: string;
  readonly type?: string;
  readonly roles?: readonly string[];
  readonly claims?: Readonly<Record<string, unknown>>;
}

export interface PolicyResource {
  readonly id: string;
  readonly type?: string;
  readonly version?: string;
  readonly provider?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PolicyInput {
  readonly action: string;
  readonly actor?: PolicyPrincipal;
  readonly agent?: PolicyPrincipal;
  readonly risk?: PolicyRiskLevel;
  readonly environment?: string;
  readonly resource?: PolicyResource;
  readonly transactionMode?: "atomic" | "compensating" | "best_effort";
  readonly adapterId?: string;
  readonly capability?: string;
  readonly simulated?: boolean;
  readonly facts?: Readonly<Record<string, unknown>>;
}

export interface PolicyObligation {
  readonly type: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly reason?: string;
  readonly obligations?: readonly PolicyObligation[];
  readonly matchedRules?: readonly string[];
}

export interface PolicyProvider<TInput extends PolicyInput = PolicyInput> {
  readonly id: string;
  readonly order?: number;
  evaluate(input: TInput): Promise<PolicyDecision | undefined> | PolicyDecision | undefined;
}
