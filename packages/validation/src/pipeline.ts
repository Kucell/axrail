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

export class ValidationPipeline<T = unknown> {
  private readonly validators = new Map<string, Validator<T>>();
  private readonly failFast: boolean;

  constructor(options: ValidationPipelineOptions = {}) {
    this.failFast = options.failFast ?? false;
  }

  register(validator: Validator<T>): void {
    if (!validator.id) throw new Error("Validator id must not be empty");
    if (this.validators.has(validator.id)) throw new Error(`Validator already registered: ${validator.id}`);
    this.validators.set(validator.id, validator);
  }

  unregister(id: string): boolean {
    return this.validators.delete(id);
  }

  list(): readonly Validator<T>[] {
    return [...this.validators.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  async validate(
    value: T,
    context: ValidationContext = {},
    stages?: readonly ValidationStage[],
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const validatorsRun: string[] = [];

    for (const validator of this.list()) {
      if (context.signal?.aborted) {
        issues.push({ code: "validation_cancelled", message: "Validation was cancelled", severity: "error", source: validator.id });
        break;
      }
      if (stages && validator.stage && !stages.includes(validator.stage)) continue;
      if (context.stage && validator.stage && validator.stage !== context.stage) continue;
      if (validator.supports && !validator.supports(value, context)) continue;

      validatorsRun.push(validator.id);
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
}
