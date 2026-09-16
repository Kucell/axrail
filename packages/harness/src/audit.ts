export type AuditFailurePolicy =
  | "best_effort"
  | "required_before_effect"
  | "required_before_commit";

export function requiresAuditBeforeEffect(policy: AuditFailurePolicy): boolean {
  return policy === "required_before_effect" || policy === "required_before_commit";
}

export function requiresAuditBeforeCommit(policy: AuditFailurePolicy): boolean {
  return policy === "required_before_commit";
}
