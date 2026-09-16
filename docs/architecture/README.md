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

## Architecture workstream

The first durable specifications should focus on:

1. Artifact Model
2. ChangeSet Protocol
3. Transaction Runtime
4. Capability and Plugin Model
5. Tool Runtime and Risk Model
6. Adapter Protocol
7. Policy and Approval Model
8. Event and Session Model

See [`../../rfcs/`](../../rfcs/) for evolving protocol proposals.
