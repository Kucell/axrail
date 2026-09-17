import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalError,
  ApprovalService,
  CallbackApprovalProvider,
  approvalRequirementsSatisfied,
  isApprovalGranted,
  type ApprovalDecision,
  type ApprovalRequest,
} from "../packages/approval/src/index.ts";

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-1",
    operation: { action: "transaction.execute", target: "project:1" },
    risk: "L2",
    reason: "test approval",
    ...overrides,
  };
}

test("ApprovalService validates requests and wraps unavailable providers", async () => {
  const service = new ApprovalService({
    provider: new CallbackApprovalProvider((req) => ({
      requestId: req.id,
      decision: "approved",
      decidedAt: "2026-09-17T00:00:00.000Z",
    })),
    now: () => "2026-09-17T00:00:00.000Z",
  });

  await assert.rejects(service.request(request({ id: "" })), (error: unknown) => {
    assert.equal(error instanceof ApprovalError, true);
    assert.equal((error as ApprovalError).code, "invalid_request");
    return true;
  });
  await assert.rejects(
    service.request(request({ requiredApprovers: [{ count: 0 }] })),
    /count must be a positive integer/,
  );
  await assert.rejects(
    service.request(request({ requiredApprovers: [{ count: 1.5 }] })),
    /count must be a positive integer/,
  );

  const broken = new ApprovalService({
    provider: { async requestApproval() { throw "offline"; } },
  });
  await assert.rejects(broken.request(request()), (error: unknown) => {
    assert.equal(error instanceof ApprovalError, true);
    assert.equal((error as ApprovalError).code, "provider_unavailable");
    assert.match((error as Error).message, /offline/);
    return true;
  });
});

test("ApprovalService checks expiry, request identity, evidence and approver requirements", async () => {
  let calls = 0;
  const expiredBefore = new ApprovalService({
    provider: { async requestApproval(req) { calls += 1; return { requestId: req.id, decision: "approved", decidedAt: "2026-09-17T00:00:00.000Z" }; } },
    now: () => "2026-09-17T01:00:00.000Z",
  });
  const expired = await expiredBefore.request(request({ expiresAt: "2026-09-17T00:30:00.000Z" }));
  assert.equal(expired.decision, "expired");
  assert.equal(calls, 0);

  const mismatch = new ApprovalService({
    provider: { async requestApproval() { return { requestId: "wrong", decision: "rejected", decidedAt: "2026-09-17T00:00:00.000Z" }; } },
  });
  await assert.rejects(mismatch.request(request()), /does not match the request id/);

  const evidenceMismatch = new ApprovalService({
    provider: { async requestApproval(req) { return { requestId: req.id, decision: "approved", decidedAt: "2026-09-17T00:00:00.000Z", evidenceDigest: "old" }; } },
  });
  await assert.rejects(evidenceMismatch.request(request({ evidenceDigest: "current" })), /not bound to the current execution evidence digest/);

  const missingRole = new ApprovalService({
    provider: { async requestApproval(req) { return { requestId: req.id, decision: "approved", decidedAt: "2026-09-17T00:00:00.000Z", approver: { id: "u", roles: ["viewer"] } }; } },
  });
  await assert.rejects(
    missingRole.request(request({ requiredApprovers: [{ role: "engineer" }] })),
    /does not satisfy the required approver quorum\/roles/,
  );

  const late = new ApprovalService({
    provider: { async requestApproval(req) { return { requestId: req.id, decision: "approved", decidedAt: "2026-09-17T02:00:00.000Z" }; } },
    now: () => "2026-09-17T00:00:00.000Z",
  });
  const lateDecision = await late.request(request({ expiresAt: "2026-09-17T01:00:00.000Z" }));
  assert.equal(lateDecision.decision, "expired");
  assert.match(lateDecision.reason ?? "", /after request expiration/);
});

test("CallbackApprovalProvider binds missing approval evidence to the request digest", async () => {
  const provider = new CallbackApprovalProvider((req) => ({
    requestId: req.id,
    decision: "approved",
    decidedAt: "2026-09-17T00:00:00.000Z",
  }));
  const decision = await provider.requestApproval(request({ evidenceDigest: "digest" }));
  assert.equal(decision.evidenceDigest, "digest");

  const explicit = new CallbackApprovalProvider((req) => ({
    requestId: req.id,
    decision: "approved",
    decidedAt: "2026-09-17T00:00:00.000Z",
    evidenceDigest: "explicit",
  }));
  assert.equal((await explicit.requestApproval(request({ evidenceDigest: "digest" }))).evidenceDigest, "explicit");
});

test("approvalRequirementsSatisfied covers roles, quorum and non-distinct principals", () => {
  const decision: ApprovalDecision = {
    requestId: "r",
    decision: "approved",
    decidedAt: "2026-09-17T00:00:00.000Z",
    approver: { id: "same", roles: ["engineer"] },
    approvers: [
      { id: "same", roles: ["engineer"] },
      { id: "other", roles: ["engineer", "reviewer"] },
    ],
  };
  assert.equal(approvalRequirementsSatisfied(undefined, decision), true);
  assert.equal(approvalRequirementsSatisfied([], decision), true);
  assert.equal(approvalRequirementsSatisfied([{ count: 2 }], decision), true);
  assert.equal(approvalRequirementsSatisfied([{ role: "engineer", count: 2 }], decision), true);
  assert.equal(approvalRequirementsSatisfied([{ role: "reviewer" }], decision), true);
  assert.equal(approvalRequirementsSatisfied([{ role: "admin" }], decision), false);
  assert.equal(
    approvalRequirementsSatisfied([{ role: "engineer", count: 3, distinctPrincipals: false }], decision),
    true,
  );
  assert.equal(approvalRequirementsSatisfied([{ role: "engineer", count: 3 }], decision), false);
});

test("isApprovalGranted rejects every stale or mismatched approval condition", () => {
  const baseRequest = request({
    id: "r",
    evidenceDigest: "digest",
    expiresAt: "2026-09-17T01:00:00.000Z",
    requiredApprovers: [{ role: "engineer" }],
  });
  const approved: ApprovalDecision = {
    requestId: "r",
    decision: "approved",
    approver: { id: "u", roles: ["engineer"] },
    decidedAt: "2026-09-17T00:00:00.000Z",
    evidenceDigest: "digest",
  };
  assert.equal(isApprovalGranted(baseRequest, approved, "2026-09-17T00:30:00.000Z"), true);
  assert.equal(isApprovalGranted(baseRequest, { ...approved, requestId: "wrong" }, "2026-09-17T00:30:00.000Z"), false);
  assert.equal(isApprovalGranted(baseRequest, { ...approved, decision: "rejected" }, "2026-09-17T00:30:00.000Z"), false);
  assert.equal(isApprovalGranted(baseRequest, approved, "2026-09-17T02:00:00.000Z"), false);
  assert.equal(isApprovalGranted(baseRequest, { ...approved, evidenceDigest: "old" }, "2026-09-17T00:30:00.000Z"), false);
  assert.equal(isApprovalGranted(baseRequest, { ...approved, approver: { id: "u", roles: ["viewer"] } }, "2026-09-17T00:30:00.000Z"), false);
});
