export type ValidationStage =
  | "schema"
  | "semantic"
  | "domain"
  | "adapter"
  | "safety"
  | "post_execution";

export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: ValidationSeverity;
  readonly path?: string;
  readonly source?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly validatorsRun: readonly string[];
}

export interface ValidationContext {
  readonly stage?: ValidationStage;
  readonly environment?: string;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Validator<T = unknown> {
  readonly id: string;
  readonly stage?: ValidationStage;
  readonly order?: number;
  supports?(value: T, context: ValidationContext): boolean;
  validate(value: T, context: ValidationContext): Promise<readonly ValidationIssue[]> | readonly ValidationIssue[];
}

export function validationPassed(validatorsRun: readonly string[] = []): ValidationResult {
  return { valid: true, issues: [], validatorsRun };
}
