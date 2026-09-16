import type {
  ApprovalDecision,
  ApprovalProvider,
  ApprovalRequest,
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
    if (!request.id) throw new ApprovalError("invalid_request", "Approval request id must not be empty");

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
  return true;
}

export class CallbackApprovalProvider implements ApprovalProvider {
  constructor(
    private readonly callback: (request: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision,
  ) {}

  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    return Promise.resolve(this.callback(request));
  }
}
