import type {
  ValidationContext,
  ValidationIssue,
  ValidationResult,
  ValidationStage,
  Validator,
} from "./contract.js";

export interface ValidationPipelineOptions {
  readonly failFast?: boolean;
}

export interface ValidationListOptions {
  readonly providerIds?: readonly string[];
}

export class ValidationPipeline<T = unknown> {
  private readonly validators = new Map<string, Validator<T>>();
  private readonly failFast: boolean;

  constructor(options: ValidationPipelineOptions = {}) {
    this.failFast = options.failFast ?? false;
  }

  register(validator: Validator<T>): () => void {
    if (!validator.id) throw new Error("Validator id must not be empty");
    const key = validatorKey(validator.id, validator.providerId);
    if (this.validators.has(key)) {
      throw new Error(
        `Validator already registered: ${validator.id}${validator.providerId ? ` (${validator.providerId})` : ""}`,
      );
    }
    this.validators.set(key, validator);
    return () => {
      if (this.validators.get(key) === validator) this.validators.delete(key);
    };
  }

  unregister(id: string, providerId?: string): boolean {
    return this.validators.delete(validatorKey(id, providerId));
  }

  list(options: ValidationListOptions = {}): readonly Validator<T>[] {
    const selected = this.selectByProvider(options.providerIds);
    return selected.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async validate(
    value: T,
    context: ValidationContext = {},
    stages?: readonly ValidationStage[],
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const validatorsRun: string[] = [];

    for (const validator of this.list({ providerIds: context.providerIds })) {
      if (context.signal?.aborted) {
        issues.push({ code: "validation_cancelled", message: "Validation was cancelled", severity: "error", source: validator.id });
        break;
      }
      if (stages && validator.stage && !stages.includes(validator.stage)) continue;
      if (context.stage && validator.stage && validator.stage !== context.stage) continue;
      if (validator.supports && !validator.supports(value, context)) continue;

      validatorsRun.push(validator.providerId ? `${validator.providerId}:${validator.id}` : validator.id);
      try {
        const result = await validator.validate(value, context);
        issues.push(...result.map((issue) => issue.source ? issue : { ...issue, source: validator.id }));
      } catch (error) {
        issues.push({
          code: "validator_error",
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
          source: validator.id,
        });
      }

      if (this.failFast && issues.some((issue) => issue.severity === "error")) break;
    }

    return {
      valid: !issues.some((issue) => issue.severity === "error"),
      issues,
      validatorsRun,
    };
  }

  private selectByProvider(providerIds: readonly string[] | undefined): Validator<T>[] {
    const all = [...this.validators.values()];
    if (!providerIds?.length) {
      // Without an explicit provider scope, only global validators are safe to
      // run automatically. Adapter-bound validation requires a resolved target.
      return all.filter((validator) => !validator.providerId);
    }

    const active = new Set(providerIds);
    return all.filter(
      (validator) => !validator.providerId || active.has(validator.providerId),
    );
  }
}

function validatorKey(id: string, providerId: string | undefined): string {
  return providerId ? `${providerId}\u0000${id}` : `\u0000${id}`;
}
