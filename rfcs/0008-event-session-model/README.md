# RFC 0008: Event and Session Model

Status: Draft

Defines append-only runtime events and session semantics for Axrail.

## 1. Motivation

Industrial AI execution must be observable, auditable, replayable, and debuggable. A final artifact state is not enough: operators and engineers need to know what the agent intended, which tools were called, which policies applied, what was validated, who approved the change, and whether execution committed or rolled back.

Axrail therefore uses structured append-only events as the runtime history model.

## 2. Event principles

Events SHOULD be:

- append-only;
- immutable after persistence;
- timestamped;
- causally linked where possible;
- scoped to session, transaction, tool call, and artifact identifiers;
- structured rather than prose-only;
- safe for audit and diagnostics;
- free of secrets and unnecessary sensitive payloads.

## 3. Event envelope

```ts
export interface AxrailEvent<T = unknown> {
  id: string
  type: string
  version: string
  time: string

  sessionId?: string
  transactionId?: string
  toolCallId?: string
  changeSetId?: string
  artifactRefs?: string[]

  actor?: PrincipalRef
  source?: string

  correlationId?: string
  causationId?: string

  data: T
  metadata?: Record<string, unknown>
}
```

## 4. Event naming

Event names SHOULD follow:

```text
<domain>.<subject>.<event>
```

Examples:

```text
session.created
intent.received
artifact.opened
changeset.proposed
transaction.started
tool.execution.started
policy.evaluation.completed
approval.requested
validation.failed
transaction.committed
transaction.rolled_back
```

## 5. Versioning

Each event type MUST have an explicit schema version.

Consumers SHOULD tolerate unknown additive fields.

Breaking changes SHOULD create a new event schema version instead of reinterpreting previously persisted events.

## 6. Session

A Session is the bounded execution context in which one or more agent interactions occur.

```ts
export interface Session {
  id: string
  createdAt: string
  status: "active" | "completed" | "failed" | "cancelled"
  actor?: PrincipalRef
  metadata?: Record<string, unknown>
}
```

A session is not the model's hidden reasoning state. It is the observable runtime context and event history.

## 7. Session event store

```ts
export interface SessionEventStore {
  append(event: AxrailEvent): Promise<void>
  read(sessionId: string, cursor?: EventCursor): AsyncIterable<AxrailEvent>
  latest?(sessionId: string): Promise<AxrailEvent | undefined>
}
```

The append operation SHOULD preserve event ordering per session.

## 8. Event ordering

Axrail SHOULD distinguish:

- wall-clock time;
- append order;
- causal order.

A monotonic sequence number MAY be assigned within a session or stream.

Distributed systems MUST NOT assume timestamps alone produce a total order.

## 9. Causation and correlation

`causationId` identifies the event that directly caused another event.

`correlationId` groups events that belong to the same broader operation.

Example:

```text
intent.received
  ↓ causation
changeset.proposed
  ↓
transaction.started
  ↓
tool.execution.started
```

All may share the same correlation ID.

## 10. Core event families

### Session events

```text
session.created
session.completed
session.failed
session.cancelled
```

### Intent events

```text
intent.received
intent.normalized
```

### Artifact events

```text
artifact.opened
artifact.snapshot.created
artifact.version.conflict
```

### ChangeSet events

```text
changeset.proposed
changeset.revised
changeset.rejected
changeset.accepted
```

### Transaction events

```text
transaction.started
transaction.prepared
transaction.commit.started
transaction.committed
transaction.rollback.started
transaction.rolled_back
transaction.failed
```

### Tool events

```text
tool.execution.requested
tool.execution.started
tool.execution.succeeded
tool.execution.failed
tool.execution.cancelled
```

### Policy events

```text
policy.evaluation.started
policy.evaluation.completed
```

### Approval events

```text
approval.requested
approval.approved
approval.rejected
approval.expired
approval.cancelled
```

### Validation events

```text
validation.started
validation.passed
validation.failed
```

## 11. Payload discipline

Events SHOULD contain references and summaries rather than uncontrolled full payloads.

For example, instead of embedding a complete proprietary project file, an event should store:

```json
{
  "artifactRef": "hmi://plant-a/project-1",
  "version": "18",
  "digest": "sha256:..."
}
```

Large payloads MAY be stored externally and referenced by URI or artifact digest.

## 12. Secrets and sensitive data

The event system MUST support redaction before persistence.

The following SHOULD NOT appear in normal event payloads:

- access tokens;
- passwords;
- private keys;
- connection secrets;
- full proprietary source/project payloads when a reference is sufficient;
- model hidden reasoning.

## 13. Audit semantics

Audit records SHOULD make it possible to answer:

- who initiated the action;
- which agent/model requested it;
- which tool executed it;
- which artifact/version was targeted;
- which policy decision applied;
- which validation ran;
- who approved it;
- whether it committed or rolled back;
- what final result was observed.

## 14. Replay

Replay can mean two different things.

### Observational replay

Reconstruct session/transaction history from persisted events.

This SHOULD be supported.

### Execution replay

Repeat external side effects from recorded events.

This MUST NOT happen implicitly. Re-execution requires a new policy/approval evaluation and must account for changed external state.

## 15. Derived state

Runtime state MAY be reconstructed by folding events.

```text
Current Session State = fold(session events)
```

However, performance-oriented snapshots MAY be stored as derived state.

The event stream remains the audit source of truth for events that have been persisted.

## 16. Concurrency

Events from parallel tool calls may interleave.

Consumers SHOULD use:

- sequence numbers;
- transaction IDs;
- tool-call IDs;
- correlation IDs;
- causation IDs;

rather than assuming adjacent events refer to the same operation.

## 17. Session context building

The Agent Runtime MAY build model context from selected session events.

This is not equivalent to dumping the full event log into the model.

Context builders SHOULD:

- select relevant events;
- summarize older history;
- exclude secrets;
- enforce token budgets;
- preserve important approvals and transaction state;
- distinguish observations from model-generated content.

## 18. Retention

Retention is deployment-specific.

Axrail SHOULD allow policies such as:

```text
short-lived development events
long-lived production audit events
separate retention for approval records
```

Adapters or organizations may require stronger retention guarantees.

## 19. Storage providers

The event/session API should support replaceable providers.

Potential implementations:

- in-memory store;
- local file/SQLite;
- relational database;
- event streaming infrastructure;
- organization audit service.

The core runtime depends on the capability contract, not a specific database.

## 20. Failure behavior

For operations requiring durable audit, failure to persist required events SHOULD fail closed before privileged commit.

Read-only or development-mode deployments MAY choose weaker durability, but the selected guarantee MUST be explicit.

## 21. Example event

```json
{
  "id": "evt_01",
  "type": "transaction.committed",
  "version": "1",
  "time": "2026-09-16T06:00:00Z",
  "sessionId": "ses_01",
  "transactionId": "tx_01",
  "changeSetId": "chg_01",
  "artifactRefs": ["hmi://factory-a/project"],
  "correlationId": "corr_01",
  "data": {
    "result": "committed",
    "artifactVersion": "19"
  }
}
```

## 22. v0.1 minimum

Axrail v0.1 needs:

1. event envelope;
2. event schema versioning;
3. session contract;
4. append/read event-store capability;
5. correlation and causation identifiers;
6. core event families;
7. redaction hooks;
8. deterministic audit events for policy, approval, validation, tools, and transactions.

Advanced distributed streaming, projections, and cross-workspace analytics can be added later.
