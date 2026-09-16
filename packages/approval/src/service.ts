import type {
  ApprovalDecision,
  ApprovalPrincipal,
  ApprovalProvider,
  ApprovalRequest,
  ApprovalRequirement,
} from "./types.js";

export class ApprovalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

export interface ApprovalServiceOptions {
  readonly provider: ApprovalProvider;
  readonly now?: () => string;
}

export class ApprovalService {
  private readonly provider: ApprovalProvider;
  private readonly now: () => string;

  constructor(options: ApprovalServiceOptions) {
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    validateRequest(request);

    if (request.expiresAt && Date.parse(request.expiresAt) <= Date.parse(this.now())) {
      return {
        requestId: request.id,
        decision: "expired",
        reason: "Approval request expired before evaluation",
        decidedAt: this.now(),
        evidenceDigest: request.evidenceDigest,
      };
    }

    let decision: ApprovalDecision;
    try {
      decision = await this.provider.requestApproval(request);
    } catch (error) {
      throw new ApprovalError(
        "provider_unavailable",
        `Approval provider failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (decision.requestId !== request.id) {
      throw new ApprovalError("request_mismatch", "Approval decision does not match the request id");
    }

    if (
      request.evidenceDigest &&
      decision.decision === "approved" &&
      decision.evidenceDigest !== request.evidenceDigest
    ) {
      throw new ApprovalError(
        "evidence_mismatch",
        "Approval decision is not bound to the current execution evidence digest",
      );
    }

    if (
      decision.decision === "approved" &&
      !approvalRequirementsSatisfied(request.requiredApprovers, decision)
    ) {
      throw new ApprovalError(
        "requirements_unsatisfied",
        "Approval decision does not satisfy the required approver quorum/roles",
      );
    }

    if (request.expiresAt && Date.parse(decision.decidedAt) > Date.parse(request.expiresAt)) {
      return {
        ...decision,
        decision: "expired",
        reason: "Approval decision arrived after request expiration",
      };
    }

    return decision;
  }
}

export function isApprovalGranted(
  request: ApprovalRequest,
  decision: ApprovalDecision,
  now: string = new Date().toISOString(),
): boolean {
  if (decision.requestId !== request.id) return false;
  if (decision.decision !== "approved") return false;
  if (request.expiresAt && Date.parse(now) > Date.parse(request.expiresAt)) return false;
  if (request.evidenceDigest && decision.evidenceDigest !== request.evidenceDigest) return false;
  if (!approvalRequirementsSatisfied(request.requiredApprovers, decision)) return false;
  return true;
}

export function approvalRequirementsSatisfied(
  requirements: readonly ApprovalRequirement[] | undefined,
  decision: ApprovalDecision,
): boolean {
  if (!requirements?.length) return true;
  const principals = approvalPrincipals(decision);

  return requirements.every((requirement) => {
    const matches = requirement.role
      ? principals.filter((principal) => principal.roles?.includes(requirement.role!))
      : principals;
    const requiredCount = requirement.count ?? 1;
    const actualCount = requirement.distinctPrincipals === false
      ? matches.length
      : new Set(matches.map((principal) => principal.id)).size;
    return actualCount >= requiredCount;
  });
}

export class CallbackApprovalProvider implements ApprovalProvider {
  constructor(
    private readonly callback: (request: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision,
  ) {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    const decision = await this.callback(request);
    if (!request.evidenceDigest || decision.evidenceDigest) return decision;
    return {
      ...decision,
      evidenceDigest: request.evidenceDigest,
    };
  }
}

function validateRequest(request: ApprovalRequest): void {
  if (!request.id) {
    throw new ApprovalError("invalid_request", "Approval request id must not be empty");
  }
  for (const requirement of request.requiredApprovers ?? []) {
    if (requirement.count !== undefined && (!Number.isInteger(requirement.count) || requirement.count < 1)) {
      throw new ApprovalError(
        "invalid_request",
        "Approval requirement count must be a positive integer",
      );
    }
  }
}

function approvalPrincipals(decision: ApprovalDecision): ApprovalPrincipal[] {
  const principals = [...(decision.approvers ?? [])];
  if (decision.approver) principals.push(decision.approver);
  return principals;
}
