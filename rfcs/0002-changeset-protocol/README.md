# RFC 0002: ChangeSet Protocol

Status: Draft

## Summary

Defines how an agent expresses proposed engineering changes as structured data before any adapter mutates an external system.

A ChangeSet is the reviewable contract between intent and execution.

## Goals

- Make agent-proposed changes explicit, inspectable, and diffable.
- Separate planning from mutation.
- Support validation, policy evaluation, approval, preview, rollback planning, and audit.
- Allow ChangeSets to target multiple engineering domains without hard-coding vendor schemas into Axrail core.
- Encourage narrow patches instead of full-project regeneration.

## Non-goals

- Define every possible HMI/PLC/robot/CAD operation.
- Replace native version-control systems.
- Guarantee that all operations are reversible.

## Conceptual model

```text
ChangeSet
├── id
├── artifact(s)
├── operations[]
├── reason
├── actor
├── preconditions
├── metadata
└── protocolVersion
```

## Proposed TypeScript contract

```ts
export interface ChangeSet {
  id: string
  protocolVersion: string
  artifacts: ArtifactRef[]
  operations: ChangeOperation[]
  reason?: string
  actor?: ActorRef
  preconditions?: Precondition[]
  metadata?: Record<string, unknown>
}

export interface ChangeOperation {
  id?: string
  op: string
  target: string
  path?: string
  value?: unknown
  from?: string
  metadata?: Record<string, unknown>
}
```

## Operation model

Axrail core SHOULD define a minimal generic vocabulary while allowing domain-specific operations.

Recommended generic operations:

```text
create
update
replace
remove
move
copy
invoke
bind
unbind
```

Adapters MAY introduce namespaced operations such as:

```text
hmi.screen.create
hmi.binding.create
plc.tag.update
robot.program.patch
mes.workflow.transition
```

Unknown operations MUST NOT be executed unless a registered capability explicitly handles them.

## Example

```json
{
  "id": "cs_01JXYZ",
  "protocolVersion": "0.1",
  "artifacts": [
    {
      "id": "hmi://factory-a/main-project",
      "type": "industrial.hmi.project",
      "version": "18",
      "provider": "company-hmi"
    }
  ],
  "reason": "Add a robot overview and recent alarm list",
  "operations": [
    {
      "id": "op-1",
      "op": "hmi.screen.create",
      "target": "project:main",
      "value": {
        "name": "Robot Overview"
      }
    },
    {
      "id": "op-2",
      "op": "hmi.component.add",
      "target": "screen:robot-overview",
      "value": {
        "type": "alarm.list",
        "limit": 20
      }
    }
  ]
}
```

## Preconditions

A ChangeSet MAY declare assumptions that MUST remain true before execution.

Examples:

```text
artifact.version == 18
screen:overview exists
component:robot-status exists
target environment == engineering
```

Preconditions SHOULD be evaluated before mutation. A failed precondition SHOULD produce a conflict or validation failure rather than partial execution.

## Atomicity

A ChangeSet describes a logical unit of change but does not itself guarantee atomic execution. Atomicity is provided by the Transaction Runtime where supported.

Adapters MUST declare whether they support:

```text
atomic
compensating
best-effort
```

For `best-effort` adapters, the transaction must surface partial-execution risk before commit.

## Dependencies between operations

Operations MAY reference prior operation IDs.

```json
{
  "id": "op-2",
  "op": "hmi.component.add",
  "target": "$op-1.screenId"
}
```

The exact reference syntax remains open for refinement. Implementations SHOULD avoid implicit ordering dependencies where an explicit dependency can be represented.

## ChangeSet lifecycle

Recommended lifecycle:

```text
draft
  ↓
proposed
  ↓
validated
  ↓
approved
  ↓
applied
  ↓
committed
```

Alternate terminal states:

```text
rejected
failed
rolled_back
superseded
```

The authoritative execution state belongs to the Transaction Runtime, not the ChangeSet document itself.

## Determinism

ChangeSets SHOULD contain enough explicit information for validators and adapters to reason about intended effects without requiring hidden model state.

The natural-language conversation that produced a ChangeSet is useful audit context, but MUST NOT be required to interpret core operations.

## Minimality

Agents SHOULD prefer the smallest ChangeSet that expresses the requested modification.

Prefer:

```text
move component A
add alarm list B
```

instead of:

```text
regenerate entire project
```

This improves safety, reviewability, latency, rollback, and merge behavior.

## Validation

Validation may operate at multiple stages:

```text
schema validation
semantic validation
domain validation
adapter validation
safety validation
post-execution validation
```

A ChangeSet can be syntactically valid while still being rejected by a domain validator.

## Policy

Policy evaluation SHOULD operate on normalized facts derived from the ChangeSet:

```text
actor
operation type
target artifact
risk level
environment
provider
requested capabilities
```

Policy MUST NOT rely solely on free-form `reason` text.

## Risk

Each operation MAY receive an explicit or computed risk classification.

```ts
interface OperationRisk {
  level: "L0" | "L1" | "L2" | "L3" | "L4" | "L5"
  reasons?: string[]
}
```

The runtime SHOULD compute transaction risk from its constituent operations and environment context rather than trusting an agent-provided value.

## Auditability

A committed ChangeSet SHOULD retain:

- original proposal
- actor/model metadata
- artifact versions
- normalized operations
- validation results
- policy decisions
- approvals
- execution results
- final artifact versions

## Idempotency

Operations that support retry SHOULD expose idempotency keys or equivalent semantics.

A transaction retry MUST NOT blindly duplicate side effects such as creating the same HMI object or issuing the same physical command.

## Security

ChangeSets are untrusted input until validated. Model output MUST never bypass schema validation or adapter authorization.

Secrets SHOULD be referenced through secure handles rather than embedded in ChangeSet payloads.

## Compatibility

The protocol SHOULD carry an explicit `protocolVersion`. Additive optional fields are backward-compatible. New mandatory execution semantics require a protocol version change.

## Open questions

- Standard operation reference/dependency syntax.
- Whether inverse operations should be part of ChangeSet or generated by adapters.
- How multi-artifact transactions express consistency constraints.
- Whether ChangeSets should support reusable templates/macros in core or a higher-level package.
