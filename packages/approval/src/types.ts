export type ApprovalRiskLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
export type ApprovalDecisionKind = "approved" | "rejected" | "expired" | "cancelled";

export interface ApprovalPrincipal {
  readonly id: string;
  readonly type?: string;
  readonly roles?: readonly string[];
  readonly displayName?: string;
}

export interface OperationSummary {
  readonly action: string;
  readonly target?: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ApprovalRequirement {
  readonly role?: string;
  readonly count?: number;
  readonly distinctPrincipals?: boolean;
}

export interface ApprovalEvidence {
  readonly changeSetId?: string;
  readonly changeSetDigest?: string;
  readonly artifactVersions?: Readonly<Record<string, string>>;
  readonly validationSummary?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly transactionId?: string;
  readonly toolCallId?: string;
  readonly actor?: ApprovalPrincipal;
  readonly operation: OperationSummary;
  readonly risk: ApprovalRiskLevel;
  readonly reason: string;
  readonly requiredApprovers?: readonly ApprovalRequirement[];
  readonly expiresAt?: string;
  readonly evidence?: ApprovalEvidence;
  readonly evidenceDigest?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ApprovalDecision {
  readonly requestId: string;
  readonly decision: ApprovalDecisionKind;
  /** Convenience for single-principal providers. */
  readonly approver?: ApprovalPrincipal;
  /** Aggregated principals for quorum/multi-party approval providers. */
  readonly approvers?: readonly ApprovalPrincipal[];
  readonly reason?: string;
  readonly decidedAt: string;
  readonly evidenceDigest?: string;
}

export interface ApprovalProvider {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}
