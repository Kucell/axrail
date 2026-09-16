# Axrail

**Transactional AI execution for industrial and engineering software.**

Axrail is open-source harness infrastructure for AI agents that safely understand, modify, validate, and execute engineering workflows. It is intentionally independent of any vendor or private HMI implementation.

> Axrail puts a governed execution boundary between model intent and engineering side effects.

## Execution model

```text
Intent
  ↓
Artifact
  ↓
ChangeSet
  ↓
Transaction
  ├─ Policy
  ├─ Validation
  └─ Approval
  ↓
Tool / Adapter / MCP
  ↓
Commit or Rollback
```

The goal is not `model → tool → execute`. Important engineering changes become explicit, reviewable data before they are committed to a target system.

## Runtime foundation

The current v0.1 foundation includes:

- **`@axrail/core`** — capability registry, plugin lifecycle, scopes, event bus, runtime shell.
- **`@axrail/harness`** — high-level composition root that binds adapters, tools, policy, approval, events, sessions, agents, and transactions into an embeddable Harness runtime.
- **`@axrail/tools`** — governed tool registry/execution, L0-L5 risk metadata, policy and approval hooks, fail-closed privileged execution.
- **`@axrail/artifacts`** — portable engineering artifact identity, versions, snapshots, providers.
- **`@axrail/changesets`** — structured engineering changes, operations, preconditions, risk metadata, and canonical digests.
- **`@axrail/validation`** — composable schema, semantic, domain, adapter, safety and post-execution validation stages.
- **`@axrail/policy`** — deny-overrides policy composition with default-deny behavior.
- **`@axrail/approval`** — approval requests, decisions, expiration, evidence binding, and fail-closed provider behavior.
- **`@axrail/transactions`** — transaction state machine, optimistic concurrency, atomic/compensating/best-effort executors, validation/policy/approval bridges and explicit rollback.
- **`@axrail/events`** — observable runtime event envelopes, EventStore contracts, session lifecycle, correlation, and replay.
- **`@axrail/adapter-sdk`** — vendor-neutral adapter lifecycle and capability manifests (`exact`, `compatible`, `degraded`, `unsupported`).
- **`@axrail/mcp`** — MCP tools bridged into the Axrail Tool Runtime instead of bypassing governance.
- **`@axrail/agent`** — model-agnostic in-process agent loop with append-only session history and sequential governed tool execution.

APIs are still draft and may change before v1.0.

## Development workspace: Kucell/axrail-agent

The separate private repository `Kucell/axrail-agent` is **development tooling used to build this Axrail repository**.

It is not part of the Axrail product runtime and must not be confused with the `@axrail/agent` package or other Agent-management capabilities implemented inside Axrail.

```text
Kucell/axrail-agent
  = development-time Agent task management
  = development plans / activities / decisions / handoffs / memory
  = records how Axrail itself is being developed

@axrail/agent
  = Axrail product runtime package
  = in-process model/tool AgentLoop

@axrail/harness
  = Axrail product runtime composition root
  = tools / policy / approval / events / transactions / adapters / agents
```

The dependency direction is intentionally one-way:

```text
Development Agent
      ↓
Kucell/axrail-agent
      ↓
works on source code in
Kucell/axrail
      ↓
builds Axrail product/runtime
```

Axrail packages must not import or depend on `Kucell/axrail-agent` at runtime.

The two repositories also record different classes of logs:

- `Kucell/axrail-agent` records **development activity** such as implementation tasks, plans, CI results, code-review evidence, architecture decisions, and development handoffs.
- Axrail `@axrail/events` records **product runtime execution** such as Agent sessions, Tool execution, Policy decisions, Approval, Transaction state, Commit, and Rollback.

A CI run produced while developing `@axrail/transactions` can be referenced by `axrail-agent`; a customer's runtime `transaction.committed` event belongs to the Axrail application's EventStore, not the development repository.

## HMI reference flow

HMI/SCADA is the first reference domain, not a dependency of the kernel.

[`examples/hmi-agent`](examples/hmi-agent/) demonstrates a vendor-neutral path with no model API key and no proprietary HMI code:

```text
Deterministic model
      ↓
AgentLoop
      ↓
ToolRuntime
      ↓
hmi.screen.create (L2)
      ↓
ChangeSet
      ↓
TransactionRuntime
   ├─ PolicyEngine
   ├─ ValidationPipeline
   └─ ApprovalService
      ↓
Mock HMI Adapter
      ↓
Commit
```

A commercial HMI, PLC IDE, robot platform, MES, CAD/CAE tool or digital-twin environment can replace the mock boundary through an Axrail Adapter.

## MCP boundary

MCP is treated as an interoperability layer, not Axrail's internal object model.

```text
LLM / Agent
    ↓
Axrail Tool Runtime
    ↓
Risk / Policy / Approval / Transaction
    ↓
MCP Bridge
    ↓
External MCP Server
```

MCP tool annotations are treated as hints. Untrusted servers cannot lower Axrail's risk classification merely by declaring a tool read-only.

## Safety boundary

Axrail software policy and approval are **not** substitutes for safety PLCs, interlocks, emergency stops, SIL/PL-rated safety functions, machine-controller safety logic, or regulated operating procedures.

Physical and safety-critical actions must remain constrained by deterministic controls outside the model.

## Architecture and RFCs

- [Architecture overview](docs/architecture/README.md)
- [Architecture and design](docs/architecture/design.md)
- [RFC-0001: Artifact Model](rfcs/0001-artifact-model/README.md)
- [RFC-0002: ChangeSet Protocol](rfcs/0002-changeset-protocol/README.md)
- [RFC-0003: Transaction Runtime](rfcs/0003-transaction-runtime/README.md)
- [RFC-0004: Capability & Plugin Model](rfcs/0004-capability-plugin-model/README.md)
- [RFC-0005: Tool Runtime & Risk Model](rfcs/0005-tool-runtime-risk-model/README.md)
- [RFC-0006: Adapter Protocol](rfcs/0006-adapter-protocol/README.md)
- [RFC-0007: Policy & Approval Model](rfcs/0007-policy-approval-model/README.md)
- [RFC-0008: Event & Session Model](rfcs/0008-event-session-model/README.md)

## Workspace

```text
packages/       Runtime packages and SDKs
examples/       Vendor-neutral reference integrations
docs/           Architecture and developer documentation
rfcs/           Protocol and architecture proposals
.github/        CI and repository automation
```

## Quick start

```bash
corepack enable
pnpm install
pnpm check
pnpm test
```

## Current priorities

The next phase focuses on durable EventStore providers, approval freshness hardening, stronger adapter kits, and refining the product-runtime Agent management boundaries inside Axrail.

## License

Apache-2.0. See [LICENSE](LICENSE).
