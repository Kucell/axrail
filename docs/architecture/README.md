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

## Architecture workstream

The next durable specifications should focus on:

6. Adapter Protocol
7. Policy and Approval Model
8. Event and Session Model

After those contracts stabilize, implementation can proceed in `@axrail/core`, `@axrail/tools`, `@axrail/transactions`, and `@axrail/adapter-sdk` with fewer architectural rewrites.
