# RFC 0007: Policy and Approval Model

Status: Draft

Defines authorization, policy evaluation, and approval semantics for Axrail operations.

## 1. Motivation

Industrial AI execution cannot treat all tool calls equally. Reading a project, modifying a draft, deploying an HMI, writing a live PLC tag, and changing safety-related parameters require different governance.

Axrail separates:

```text
Policy   → Is this operation allowed?
Approval → Who must explicitly authorize it?
```

Policy and approval are related but independent.

## 2. Policy inputs

A policy decision may depend on:

- actor identity;
- actor roles;
- agent identity;
- model/provider;
- tool identifier;
- tool risk level;
- artifact type and version;
- transaction mode;
- environment (`design`, `test`, `production`);
- target adapter;
- target capability;
- requested operation;
- live versus simulated execution;
- time or deployment window;
- organization-specific claims.

## 3. Policy decision

```ts
export interface PolicyDecision {
  effect: "allow" | "deny" | "require-approval"
  reason?: string
  obligations?: PolicyObligation[]
  matchedRules?: string[]
}
```

`deny` MUST prevent execution.

`require-approval` MUST prevent privileged execution until the required approval is satisfied.

## 4. Policy engine

```ts
export interface PolicyEngine {
  evaluate(input: PolicyInput): Promise<PolicyDecision>
}
```

Multiple policy providers may participate.

The default composition rule SHOULD be deny-overrides:

```text
any DENY             → DENY
otherwise any APPROVAL → REQUIRE APPROVAL
otherwise              → ALLOW
```

Applications MAY define stricter composition.

## 5. Policy obligations

Policies may attach obligations that must be satisfied before execution.

Examples:

```text
require-dry-run
require-transaction
require-validator:plc.compile
require-environment:test
require-two-person-approval
require-audit-retention
```

Obligations are deterministic runtime requirements, not natural-language recommendations.

## 6. Approval request

```ts
export interface ApprovalRequest {
  id: string
  transactionId?: string
  toolCallId?: string
  actor: Principal
  operation: OperationSummary
  risk: RiskLevel
  reason: string
  requiredApprovers: ApprovalRequirement[]
  expiresAt?: string
  evidence?: ApprovalEvidence
}
```

The request SHOULD contain enough structured information for an approver to understand the effect of the operation without inspecting raw agent chain-of-thought.

## 7. Approval decision

```ts
export interface ApprovalDecision {
  requestId: string
  decision: "approved" | "rejected" | "expired" | "cancelled"
  approver?: Principal
  reason?: string
  decidedAt: string
}
```

Approval decisions MUST be persisted as audit events.

## 8. Approval scopes

Approval may apply to:

- one tool call;
- one ChangeSet;
- one transaction;
- one artifact version;
- one deployment target;
- a bounded execution window.

Broad, indefinite approvals SHOULD be discouraged for high-risk operations.

## 9. Risk-aware defaults

Axrail's default risk model SHOULD map to conservative approval behavior.

| Risk | Default expectation |
| --- | --- |
| L0 | no approval |
| L1 | usually no approval |
| L2 | policy dependent; engineering approval common |
| L3 | explicit deployment approval recommended |
| L4 | explicit operator/owner approval required by default |
| L5 | fail closed unless a specialized integration explicitly supports the operation |

Adapters may strengthen these requirements but SHOULD NOT silently weaken them.

## 10. Human and machine approvals

An approval provider may be human-facing or machine-facing.

Examples:

- interactive UI confirmation;
- CLI confirmation;
- organization approval service;
- signed policy decision from an external control plane.

For high-risk physical actions, a machine approval alone SHOULD NOT be interpreted as a substitute for independent safety controls.

## 11. Multi-party approval

Some operations may require multiple independent approvals.

```ts
export interface ApprovalRequirement {
  role?: string
  count?: number
  distinctPrincipals?: boolean
}
```

Example:

```yaml
requiredApprovers:
  - role: controls-engineer
    count: 1
  - role: production-owner
    count: 1
```

## 12. Approval freshness

An approval MUST become invalid when material execution context changes.

Examples:

- artifact version changed;
- ChangeSet changed;
- deployment target changed;
- risk classification increased;
- policy obligations changed;
- approval expired.

The runtime SHOULD bind approval to a stable digest of relevant execution inputs.

## 13. Fail-closed behavior

When required approval cannot be evaluated or obtained, privileged execution MUST NOT proceed.

Examples include:

- approval service unavailable;
- approver identity ambiguous;
- approval record corrupted;
- target artifact changed after approval.

## 14. Separation from validation

Approval does not mean a change is technically valid.

```text
approved + invalid → do not commit
valid + unapproved → do not commit when approval is required
```

Both conditions must independently pass.

## 15. Separation from physical safety

Axrail approval is a software governance mechanism.

It MUST NOT be represented as a replacement for:

- safety PLCs;
- interlocks;
- emergency stops;
- SIL/PL-rated safety functions;
- machine controller safety logic;
- regulated operating procedures.

For physical actions, Axrail operates above those deterministic safety layers.

## 16. Example policy

```yaml
id: production-deploy
match:
  tool: hmi.deploy
  environment: production
effect: require-approval
obligations:
  - require-transaction
  - require-validator:hmi.project.validate
approvers:
  - role: project-owner
```

## 17. Example live-control policy

```yaml
id: live-machine-command
match:
  risk: L4
effect: require-approval
obligations:
  - require-runtime-preconditions
  - require-audit-retention
approvers:
  - role: operator
```

## 18. Audit events

The runtime SHOULD emit:

```text
policy.evaluation.started
policy.evaluation.completed
approval.requested
approval.approved
approval.rejected
approval.expired
approval.cancelled
```

Sensitive credentials MUST NOT be included in event payloads.

## 19. v0.1 minimum

Axrail v0.1 needs:

1. `PolicyInput`;
2. `PolicyDecision`;
3. deny-overrides composition;
4. policy obligations;
5. approval request/decision contracts;
6. approval binding to transaction/tool-call context;
7. fail-closed semantics;
8. audit events.

Advanced delegation and organization policy languages can be added later.
