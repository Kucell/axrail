# Axrail Correlated Audit Model

Axrail records observable execution events without persisting model hidden reasoning.

## Correlation identifiers

A single engineering request may span:

- an agent session;
- one or more tool calls;
- policy evaluations;
- approval requests;
- ChangeSets;
- transactions;
- artifact mutations.

The following identifiers connect those layers:

```text
sessionId
correlationId
transactionId
toolCallId
changeSetId
artifactRefs[]
```

`correlationId` is the broad workflow/work-order key. Other identifiers address a specific execution boundary.

## Event families

```text
session.*
agent.*
tool.execution.*
policy.evaluation.*
approval.*
transaction.*
audit.effect.checkpoint
audit.commit.checkpoint
```

## Three classes of persisted records

Axrail intentionally distinguishes three persistence semantics.

### 1. Session state events

`session.created`, `session.completed`, `session.failed`, and `session.cancelled` are authoritative state for `SessionService`. Their persistence failure is not treated as optional telemetry failure because session replay depends on them.

### 2. Observational runtime events

Tool, Policy, Approval, Agent, and Transaction lifecycle events are normal observability/audit records. A post-effect observer failure must not automatically rewrite an already-applied physical or engineering side effect into a fictional `execution_failed` result.

### 3. Authoritative audit checkpoints

Strict Harness profiles add explicit durable checkpoints before irreversible or externally visible boundaries:

```text
audit.effect.checkpoint
audit.commit.checkpoint
```

If a required checkpoint cannot be persisted, Axrail fails closed before that boundary.

## Audit failure profiles

`HarnessRuntime` exposes an explicit `auditPolicy`:

```text
best_effort
required_before_effect
required_before_commit
```

### `best_effort`

- ordinary Tool/Transaction audit events are persisted when possible;
- observer persistence failures do not block Tool execution or Transaction progress;
- no authoritative audit checkpoint is required.

This is the default development/embedded profile.

### `required_before_effect`

Before a Tool executes or a Transaction enters `apply()`, Axrail must persist an `audit.effect.checkpoint` containing the governed execution identifiers/evidence. Failure returns `audit_unavailable` and the side effect is not started.

### `required_before_commit`

This includes the `required_before_effect` guarantee and additionally requires `audit.commit.checkpoint` before Transaction commit. A failed commit checkpoint prevents `executor.commit()` from running.

For compensating or best-effort transactions, the effect checkpoint is still required before `apply()` because `apply()` itself may already touch an external system.

## Why ordinary events stay observational

Making every event append fatal creates an unsafe ambiguity: a Tool may execute successfully, then fail to persist `tool.execution.succeeded`, causing the caller to see an error even though the side effect already happened. Axrail therefore uses explicit pre-effect/pre-commit checkpoints for fail-closed audit guarantees and keeps ordinary lifecycle events observational.

## Sensitive data

Events should contain references, evidence digests, targets, and summaries rather than secrets, full proprietary project payloads, or hidden model reasoning. `EventStore` redaction hooks run before persistence.
