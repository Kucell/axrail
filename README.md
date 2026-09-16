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
- **`@axrail/tools`** — governed tool registry/execution, L0-L5 risk metadata, policy and approval hooks, fail-closed privileged execution.
- **`@axrail/artifacts`** — portable engineering artifact identity, versions, snapshots, providers.
- **`@axrail/changesets`** — structured engineering changes, operations, preconditions, risk metadata.
- **`@axrail/validation`** — composable schema, semantic, domain, adapter, safety and post-execution validation stages.
- **`@axrail/policy`** — deny-overrides policy composition with default-deny behavior.
- **`@axrail/approval`** — approval requests, decisions, expiration and fail-closed provider behavior.
- **`@axrail/transactions`** — transaction state machine, optimistic concurrency, atomic/compensating/best-effort executors, validation/policy/approval bridges and explicit rollback.
- **`@axrail/adapter-sdk`** — vendor-neutral adapter lifecycle and capability manifests (`exact`, `compatible`, `degraded`, `unsupported`).
- **`@axrail/mcp`** — MCP tools bridged into the Axrail Tool Runtime instead of bypassing governance.
- **`@axrail/agent`** — model-agnostic agent loop with append-only session history and sequential governed tool execution.

APIs are still draft and may change before v1.0.

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

The remaining v0.1 work is focused on behavioral tests, event/session persistence, model-provider adapters, an official MCP SDK transport integration, and stronger reference adapters/examples.

## License

Apache-2.0. See [LICENSE](LICENSE).
