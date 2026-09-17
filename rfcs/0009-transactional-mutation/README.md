# RFC 0009: Transactional Mutation Pipeline

Status: Draft

Defines how durable engineering mutations should converge from governed Tool intent into ChangeSet + Transaction execution.

## 1. Motivation

Axrail v0.1 contains both a strong governed Tool Runtime and a strong Transaction Runtime, but they are still independently usable. That is valuable for flexibility, yet it leaves an architectural ambiguity for durable engineering writes:

```text
Tool → direct effect
```

versus:

```text
Tool / Intent → ChangeSet → Transaction → controlled effect
```

For Axrail's industrial execution model, durable engineering changes should increasingly use the second path.

This RFC defines the convergence direction without retroactively changing the already published v0.1 API.

## 2. Goals

The Transactional Mutation pipeline should:

- make ChangeSet + Transaction the normal path for durable engineering writes;
- preserve Tool governance and immutable invocation evidence;
- keep read/query Tools lightweight;
- support preview before commit where the Adapter can provide it;
- preserve optimistic concurrency and Artifact version checks;
- bind Policy, Validation and Approval to immutable change evidence;
- provide explicit commit/rollback/compensation semantics;
- preserve effect uncertainty when an external outcome cannot be proven;
- allow a Harness-level high-level API so applications do not rebuild orchestration themselves;
- remain usable across HMI, PLC, robotics, MES, CAD/CAE and other engineering systems.

## 3. Non-goals

This RFC does not attempt to define:

- generic multi-agent planning;
- distributed transactions across arbitrary external systems;
- a cloud control plane;
- a universal workflow engine;
- safety-system replacement;
- a generic plugin kernel.

## 4. Target execution model

```text
Human / Agent Intent
        ↓
Governed Tool / Change Proposal
        ↓
ChangeSet
        ↓
Preview (when supported)
        ↓
Transaction
   ├─ Policy
   ├─ Validation
   ├─ Approval
   └─ Audit checkpoints
        ↓
Adapter TransactionExecutor
        ↓
Apply
        ↓
Verify
        ↓
Commit
        ↓
Committed
```

Failure/recovery path:

```text
apply / verify / commit failure
        ↓
rollback or compensation when possible
        ↓
rolled_back / partially_applied / explicit uncertainty
```

## 5. Risk-directed mutation semantics

Default architecture direction:

```text
L0  read/query
    → governed Tool execution

L1  local/draft mutation
    → Tool or Transaction depending on contract/policy

L2  engineering modification
    → ChangeSet + Transaction by default

L3  deploy/overwrite engineering state
    → Transaction required by default

L4  physical action
    → explicit command/effect semantics + approval
    → deterministic external safety boundary remains authoritative
    → do not assume rollback is possible

L5  safety-critical operation
    → explicit Transaction boundary + Approval + deployment opt-in
    → deterministic safety functions remain authoritative
```

Adapters and deployments may enforce stricter rules.

## 6. Tool relationship

Tools remain the semantic callable surface for Agents.

A mutation Tool may follow one of these patterns.

### A. Change proposal Tool

```text
Agent calls Tool
  ↓
Tool produces ChangeSet
  ↓
Harness executes ChangeSet transactionally
```

This is preferred when an Agent needs to construct a user-reviewable engineering change.

### B. Transaction-bound execution Tool

```text
Agent calls Tool
  ↓
Policy requires Transaction
  ↓
Tool executes only inside an existing Transaction context
```

Useful when a higher-level workflow already owns the Transaction.

### C. Direct governed Tool

Primarily for reads, queries, diagnostics, or explicitly allowed low-risk/local operations.

Direct effect should not become the normal path for durable L2/L3 engineering mutations.

## 7. ChangeSet requirements

A ChangeSet used for durable execution should provide immutable evidence identity covering at least:

- ChangeSet ID/version;
- targeted Artifact references;
- operations;
- preconditions;
- actor/reason metadata where applicable;
- risk metadata;
- canonical digest.

Preview, Validation and Approval should refer to the same immutable change identity that is later executed.

If the ChangeSet changes after Approval, Approval must no longer authorize the mutated content.

## 8. Harness-level API direction

Applications should not have to manually instantiate and wire a TransactionRuntime for every normal engineering mutation.

The first post-RC implementation on `main` exposes an experimental high-level path shaped as:

```ts
await harness.executeChangeSet(changeSet, {
  adapterId,
  executor,
  actor,
  environment,
  sessionId,
  correlationId,
  requiredApprovers,
})
```

`executor` is currently explicit and required. `adapterId` is optional, but when provided it must identify an already mounted Adapter and scopes Adapter Policy/Validation/provider context for the Transaction. The implementation deliberately does not guess an executor or silently select the first mounted Adapter.

This post-RC API is not part of the already published `0.1.0-rc.1` artifact. Its exact public shape remains pre-stable and is being validated for a subsequent release.

The current high-level operation composes:

```text
ChangeSet
  ↓
explicit TransactionExecutor
  + optional mounted Adapter scope
  ↓
TransactionRuntime
  ↓
Adapter-scoped Policy + Validation
  ↓
Approval
  ↓
Apply / Verify / Commit
```

It reuses the existing TransactionRuntime rather than introducing a second mutation engine, while retaining the lower-level TransactionRuntime API for advanced consumers.

## 9. Executor resolution

The first stable direction prioritizes single-target execution.

```text
one ChangeSet
  ↓
one primary Adapter scope
  ↓
one TransactionExecutor
```

The first implementation requires an application-supplied `TransactionExecutor` and optionally an explicit mounted `adapterId`. This keeps target selection deterministic while the Adapter executor-resolution contract is still being validated.

Future executor resolution may use one or more explicit signals:

- an application-supplied Adapter ID;
- Artifact provider identity;
- ChangeSet target metadata;
- an explicit executor resolver.

Unsafe ambiguity must fail closed.

Implicit "pick the first available Adapter" behavior is not acceptable for privileged mutation.

## 10. Preview

Preview is optional at the protocol level because not every target system supports it.

Where supported, preview should be generated from the immutable ChangeSet and produce structured evidence suitable for human or machine review.

Capability support should be reported as:

```text
exact
compatible
degraded
unsupported
```

A degraded or unsupported preview capability must not be represented as authoritative.

## 11. Policy

Policy may evaluate both Tool invocation evidence and Transaction/ChangeSet evidence.

For durable mutation, Transaction Policy should be authoritative for whether the ChangeSet can proceed.

Policy may require obligations such as:

```text
require-transaction
require-environment
require-preview
require-approval-role
```

Unsupported obligations must fail closed.

## 12. Validation

Validation should support distinct phases:

```text
pre-execution structural/schema validation
pre-execution domain validation
Adapter-specific validation
post-apply verification / result validation
```

A successful Policy decision does not imply technical validity.

## 13. Approval

Approval must bind to immutable execution evidence.

At minimum, the approved evidence should identify the exact ChangeSet digest and relevant execution target/context.

A changed ChangeSet, changed target, or materially changed privileged execution context must invalidate stale Approval where the change affects authorized evidence.

## 14. Audit

Strict audit profiles may require authoritative checkpoints:

```text
before external effect
before commit
```

Ordinary lifecycle telemetry remains observational and must not rewrite execution truth after an external effect.

## 15. Apply, verify, commit and rollback

Adapters/executors may implement:

```text
atomic
compensating
best_effort
```

The mode must reflect real target semantics.

### Atomic

The target can make the entire change durable atomically.

### Compensating

The executor can undo previously applied steps through compensation.

### Best effort

Rollback cannot be guaranteed. This limitation must be explicit before Approval/commit.

The v0.1 TransactionRuntime intentionally keeps rollback explicit after a failed phase because not every engineering or physical effect is safely reversible. The high-level `executeChangeSet()` slice preserves that behavior rather than silently adding automatic rollback. Automatic recovery policy, if added later, requires explicit semantics for target reversibility and uncertainty.

## 16. Effect uncertainty

Industrial and engineering APIs may return an uncertain outcome.

Examples:

- timeout after sending a write;
- network loss while the target may already have applied the change;
- postcondition check fails after a side effect;
- commit acknowledgement is missing.

The runtime must not collapse these into ordinary retry-safe failure.

Possible outcomes include:

```text
execution_uncertain
partially_applied
verification_failed
rollback_failed
```

Automatic retry should depend on proven idempotence and known target state.

## 17. Relationship to physical actions

Not every physical effect is meaningfully transactional.

For example, "start motor" cannot be treated like editing a configuration file and assumed rollback-safe.

Therefore the Transactional Mutation pipeline primarily targets durable engineering-state mutation. Physical command execution may use Transaction boundaries for governance/evidence while still declaring non-reversible or best-effort semantics.

Deterministic machine safety controls remain outside the model and remain authoritative.

## 18. HMI validation slice

The first real vertical validation should demonstrate:

```text
inspect project
  ↓
inspect/select screen
  ↓
construct screen/component ChangeSet
  ↓
preview
  ↓
validate
  ↓
policy
  ↓
approval
  ↓
apply
  ↓
verify
  ↓
commit
```

and at least one failure path:

```text
failed validation
version conflict
approval denial
apply failure
rollback/compensation
uncertain external result
```

## 19. Compatibility and migration

The published v0.1 Tool and Transaction APIs remain valid. The npm `0.1.0-rc.1` artifacts correspond to source commit `e4758656c20f6cb90b05eb3429c79010667a2f7d`; they do not contain the post-RC `HarnessRuntime.executeChangeSet()` implementation described above.

This RFC describes a higher-level convergence path for future versions. The first implementation is currently development evidence on `main`, not a retroactive modification of the published RC1 contract. Existing consumers are not required to convert every Tool into a ChangeSet immediately.

Migration should occur incrementally:

1. identify durable L2/L3 mutation Tools;
2. add explicit ChangeSet production or Transaction requirements;
3. provide high-level Harness execution;
4. validate using a real HMI Adapter;
5. stabilize public contracts for v0.2.

## 20. Acceptance criteria

The broader RFC is ready for stabilization when:

1. Harness exposes a high-level ChangeSet execution path;
2. one target Adapter/executor is resolved deterministically;
3. L2/L3 mutation examples use ChangeSet + Transaction by default;
4. Policy/Validation/Approval are bound to immutable ChangeSet evidence;
5. preview support is explicit and evidence-bound;
6. optimistic concurrency is enforced;
7. apply/verify/commit/rollback paths have behavioral tests;
8. uncertainty states prevent unsafe automatic retry assumptions;
9. a real HMI integration completes an end-to-end vertical slice;
10. no public API requires `@axrail/core` to make the pipeline work.

The initial Harness slice is intentionally narrower than full RFC stabilization: it establishes the high-level execution entry point, explicit Adapter/executor binding, provider-scoped governance, and behavioral validation while deferring preview/executor resolution and the real HMI vertical slice to subsequent Cortex tasks.
