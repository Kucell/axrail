# RFC 0003: Transaction Runtime

Status: Draft

## Summary

Defines the Axrail transaction lifecycle used to safely apply engineering ChangeSets under policy, validation, approval, concurrency, and rollback constraints.

A Transaction is the execution boundary between a proposed ChangeSet and durable mutation of an external engineering system.

## Goals

- Prevent agents from mutating privileged engineering systems directly.
- Provide a consistent lifecycle for policy, validation, approval, preview, commit, and rollback.
- Surface adapter atomicity and rollback limitations explicitly.
- Support optimistic concurrency and version-conflict detection.
- Produce an auditable event trail for every meaningful execution decision.

## Non-goals

- Emulate a distributed database transaction across arbitrary vendors.
- Guarantee perfect rollback when an external platform cannot provide it.
- Replace hard real-time or safety-certified control systems.

## Core lifecycle

```text
CREATED
   ↓
PREPARING
   ↓
POLICY_CHECKED
   ↓
VALIDATED
   ↓
AWAITING_APPROVAL   (optional)
   ↓
APPROVED
   ↓
APPLYING
   ↓
VERIFYING
   ↓
COMMITTED
```

Possible terminal/alternate states:

```text
REJECTED
FAILED
CONFLICTED
ROLLING_BACK
ROLLED_BACK
PARTIALLY_APPLIED
CANCELLED
```

## Proposed TypeScript contracts

```ts
export type TransactionState =
  | "created"
  | "preparing"
  | "policy_checked"
  | "validated"
  | "awaiting_approval"
  | "approved"
  | "applying"
  | "verifying"
  | "committed"
  | "rejected"
  | "failed"
  | "conflicted"
  | "rolling_back"
  | "rolled_back"
  | "partially_applied"
  | "cancelled"

export interface Transaction {
  id: string
  changeSet: ChangeSet
  state: TransactionState
  createdAt: string
  updatedAt: string
  context: TransactionContext
}

export interface TransactionContext {
  actor?: ActorRef
  environment?: string
  adapterIds?: string[]
  expectedVersions?: Record<string, string>
  metadata?: Record<string, unknown>
}
```

## Runtime API

Initial API shape:

```ts
const tx = await runtime.begin(changeSet, context)

await tx.prepare()
await tx.evaluatePolicy()
await tx.validate()
await tx.requestApproval()
await tx.apply()
await tx.verify()
await tx.commit()
```

Convenience orchestration MAY offer:

```ts
const result = await runtime.execute(changeSet, context)
```

but MUST preserve the same observable lifecycle and controls.

## Preparation

Preparation resolves the execution plan without mutating the target system.

Typical work:

- resolve artifact providers
- resolve adapters and tools
- normalize ChangeSet operations
- capture baseline versions/snapshots
- determine supported transaction mode
- calculate required risk classification
- build policy input
- discover validators
- determine approval requirements

Preparation SHOULD fail before any external mutation when required capabilities are unavailable.

## Transaction modes

Adapters MUST declare one of the following execution guarantees for relevant operations.

### Atomic

The external platform can stage all mutations and either commit all or none.

```text
begin → stage → validate → commit
                       ↘ rollback
```

### Compensating

The platform does not provide true atomicity, but Axrail can generate or invoke compensating operations.

```text
apply A
apply B
B fails
undo A
```

Compensation does not imply perfect restoration. The runtime MUST expose residual risk.

### Best-effort

The platform cannot guarantee atomicity or reliable compensation.

The user/policy MUST be able to prohibit best-effort execution for high-risk operations.

## Policy phase

Policy runs before privileged mutation and evaluates normalized transaction facts.

Inputs SHOULD include:

- actor identity and roles
- target artifacts
- operations
- computed risk
- environment
- adapter/provider
- requested capabilities
- transaction mode
- approval requirements

Possible outcomes:

```text
allow
deny
require_approval
require_condition
```

A denial is terminal unless a new transaction is created with different inputs/context.

## Validation phase

Validation MUST happen before commit and MAY also run after apply.

Suggested validator categories:

```text
schema
precondition
semantic
domain
adapter
safety
post-execution
```

Validation results SHOULD be structured:

```ts
interface ValidationResult {
  status: "pass" | "fail" | "warning"
  validator: string
  code?: string
  message?: string
  details?: unknown
}
```

Warnings MAY influence policy or approval even when they do not block execution.

## Approval phase

Approval is conditional, not mandatory for every transaction.

Approval requests SHOULD include a stable transaction summary rather than raw chat text:

- intended ChangeSet
- artifacts and versions
- computed risk
- target environment
- validation results
- adapter transaction guarantees
- predicted side effects

Approval decisions MUST be bound to the transaction identity and, where relevant, the exact ChangeSet hash/version.

If the ChangeSet changes after approval, approval SHOULD be invalidated.

## Apply vs Commit

Axrail distinguishes `apply` from `commit` where a target platform supports staging.

### Apply

Stages or executes proposed changes inside the transaction boundary.

### Commit

Makes the transaction durable/authoritative after verification.

For adapters without staging, `apply` may perform real mutations. Those adapters MUST declare this behavior so policy/approval can account for it.

## Verification

Verification checks whether the observed external state matches the expected postconditions.

Examples:

- expected HMI component exists
- PLC project compiles
- binding resolves to a valid tag
- deployment reports the expected revision
- robot program checksum matches the generated artifact

For physical control operations, verification MUST NOT replace machine safety systems.

## Optimistic concurrency

Transactions SHOULD capture artifact versions during preparation.

Before mutation or final commit:

```text
expected version == current version ? proceed : conflict
```

On conflict, the runtime SHOULD transition to `conflicted` and MUST NOT silently overwrite concurrent engineering changes unless an explicit policy enables that behavior.

## Rollback

Rollback semantics depend on adapter capability.

Rollback SHOULD record:

- which operations were applied
- which were reversed
- which reversals failed
- final observed state
- whether manual intervention is required

The runtime MUST NOT report `rolled_back` if meaningful external mutations remain unresolved. Use `partially_applied` or a similarly explicit failure state.

## Failure handling

Failures are classified at minimum as:

```text
policy_denied
approval_denied
validation_failed
version_conflict
adapter_unavailable
execution_failed
verification_failed
rollback_failed
cancelled
```

Errors SHOULD have stable machine-readable codes in addition to human-readable messages.

## Idempotency and retry

Retries MUST respect operation idempotency.

A transaction SHOULD have a stable execution ID. Adapters MAY use it as an idempotency key.

The runtime MUST NOT assume that a timed-out external operation failed. Before retry, it SHOULD reconcile observed target state when possible.

## Event model

Suggested events:

```text
transaction.created
transaction.preparing
transaction.prepared
policy.evaluated
validation.completed
approval.requested
approval.granted
approval.denied
transaction.applying
operation.started
operation.completed
operation.failed
transaction.verifying
transaction.committed
transaction.conflicted
transaction.rolling_back
transaction.rolled_back
transaction.partial
transaction.failed
```

Events SHOULD be append-only and carry correlation IDs for transaction, ChangeSet, session, and tool execution.

## Transaction journal

The runtime SHOULD maintain a journal containing enough information to recover or diagnose interrupted transactions.

At minimum:

- transaction ID
- ChangeSet identity/hash
- baseline artifact versions
- operation progress
- external execution references
- policy decisions
- validation results
- approval records
- rollback/compensation data

Durability requirements can vary by deployment profile.

## Crash recovery

A runtime restart SHOULD NOT automatically re-execute unknown in-flight side effects.

Recovery strategy:

```text
load journal
   ↓
reconcile external state
   ↓
classify transaction
   ├─ safe to resume
   ├─ safe to rollback
   └─ requires manual intervention
```

## Nested transactions

Nested transactions are deferred for v0.1.

For initial implementation, one Axrail Transaction SHOULD own the complete ChangeSet execution boundary. Higher-level workflows may sequence multiple transactions.

## Multi-artifact transactions

A ChangeSet MAY target multiple artifacts. True atomicity across different providers is not guaranteed.

The runtime MUST calculate the weakest guarantee across participating adapters and expose it before approval/commit.

Example:

```text
HMI adapter: atomic
PLC adapter: compensating
MES adapter: best-effort

Overall guarantee: best-effort
```

Policy MAY deny a transaction whose aggregate guarantee is below a required threshold.

## Physical actions

Axrail transactions can govern requests that ultimately cause physical actions, but Axrail MUST NOT be treated as a safety PLC or certified safety function.

Safety-critical conditions remain enforced by appropriate deterministic industrial control and safety systems.

For L4/L5 actions, implementations SHOULD require stronger policy, explicit runtime context, and human authorization by default.

## Observability

Transactions SHOULD expose:

- current state
- timestamps/durations
- operation progress
- active adapter/provider
- risk classification
- pending approval
- validation failures
- commit/rollback outcome

## Compatibility

The transaction state machine may gain additive intermediate states without breaking the conceptual lifecycle. Removing or changing terminal-state semantics requires a major protocol revision.

## Open questions

- Exact hashing/signature format binding approval to a ChangeSet.
- Standard recovery protocol for interrupted external operations.
- Whether v0.1 should define compensating operation interfaces or leave them adapter-specific.
- Whether transaction journals belong in core or a storage package.
- How cross-provider locks should be represented, if at all.
