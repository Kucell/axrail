# Architecture

Axrail separates agent intent from governed execution. Core artifacts are portable data; adapters perform application-specific work; transactions coordinate policy, validation, approval, and commit.

## Documents

- [Architecture and Design](design.md) — project positioning, execution model, first-class concepts, module boundaries, tool runtime, risk model, adapters, MCP integration, HMI reference-domain boundary, roadmap, and RFC sequence.

## Core model

```text
Intent
  ↓
ChangeSet
  ↓
Transaction
  ↓
Policy
  ↓
Validation
  ↓
Approval
  ↓
Commit
```

## RFCs

1. [RFC-0001 Artifact Model](../../rfcs/0001-artifact-model/README.md)
2. [RFC-0002 ChangeSet Protocol](../../rfcs/0002-changeset-protocol/README.md)
3. [RFC-0003 Transaction Runtime](../../rfcs/0003-transaction-runtime/README.md)
4. [RFC-0004 Capability & Plugin Model](../../rfcs/0004-capability-plugin-model/README.md)
5. [RFC-0005 Tool Runtime & Risk Model](../../rfcs/0005-tool-runtime-risk-model/README.md)
6. [RFC-0006 Adapter Protocol](../../rfcs/0006-adapter-protocol/README.md)
7. [RFC-0007 Policy & Approval Model](../../rfcs/0007-policy-approval-model/README.md)
8. [RFC-0008 Event & Session Model](../../rfcs/0008-event-session-model/README.md)

## Implementation workstream

The v0.1 protocol skeleton is now complete enough to start implementation with substantially less architectural churn.

Recommended implementation order:

1. `@axrail/core` — capability registry, plugin lifecycle, scopes, events
2. `@axrail/tools` — tool contracts, registry, risk metadata, controlled execution pipeline
3. `@axrail/artifacts` and `@axrail/changesets` — portable engineering data contracts
4. `@axrail/policy`, `@axrail/approval`, `@axrail/validation` — governance pipeline
5. `@axrail/transactions` — transaction state machine, prepare/commit/rollback
6. `@axrail/adapter-sdk` — external engineering-system boundary
7. `@axrail/mcp` — bridge MCP tools into Axrail-native execution
8. `@axrail/agent` — agent loop built on top of the governed runtime

The implementation should continue to treat HMI as a reference domain rather than a kernel dependency.
