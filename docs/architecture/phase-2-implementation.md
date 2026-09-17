# Phase 2 — Transactional Mutation Implementation

Status: Active implementation plan

This document turns RFC-0009 into an incremental implementation sequence for `@axrail/harness`, `@axrail/transactions`, and `@axrail/adapter-sdk`.

## Objective

Make ChangeSet + Transaction the default high-level path for durable engineering mutation without duplicating governance logic already implemented by the Transaction Runtime.

## First increment

Add a Harness-level ChangeSet execution API that:

- accepts a `ChangeSet` plus transaction context;
- selects an explicit transaction executor supplied by the caller for v0.1-compatible behavior;
- constructs the existing `TransactionRuntime` through `HarnessRuntime.createTransactionRuntime()`;
- runs the existing transaction lifecycle instead of reimplementing policy, validation, approval, audit, concurrency, apply, verify, commit, and rollback semantics;
- returns the final immutable transaction record;
- keeps Adapter executor discovery deferred until its resolution semantics are validated by the real HMI Adapter.

The first increment intentionally does not auto-select `AdapterTransactionParticipant`. That surface remains experimental.

## Target API direction

```ts
await harness.executeChangeSet(changeSet, {
  executor,
  context: {
    actor,
    environment,
    adapterIds,
    sessionId,
    correlationId,
  },
  requiredApprovers,
})
```

The exact public API remains pre-v0.2 and may evolve during the real HMI vertical slice.

## Follow-up increments

1. Adapter-backed executor resolution with explicit provider selection.
2. Preview contract before protected mutation where supported.
3. Mutation-oriented Tool helper that yields a ChangeSet rather than applying the effect directly.
4. End-to-end HMI flow: Agent → proposal → ChangeSet → approval → transaction → adapter → verify → commit/rollback.
5. Recovery/resume semantics for effect uncertainty and interrupted execution.

## Boundary rules

- `@axrail/harness` composes existing runtimes; it must not duplicate transaction governance.
- `@axrail/tools` remains usable for reads and imperative operations where a transaction is not semantically appropriate.
- Durable L2/L3 engineering writes should converge on ChangeSet + Transaction.
- L4 physical actions must not be falsely represented as rollback-safe engineering edits.
- L5 safety-critical effects remain subordinate to deterministic external safety systems.
