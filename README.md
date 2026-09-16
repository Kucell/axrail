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

The implemented v0.1 functional foundation includes:

- **`@axrail/harness`** — primary high-level composition root that binds adapters, tools, policy, approval, events, sessions, agents, transactions, provider-aware Tool routing, and explicit audit profiles into an embeddable Harness runtime.
- **`@axrail/tools`** — governed Tool registry/execution, immutable Tool invocation evidence, provider-aware semantic Tool resolution, L0-L5 risk metadata, policy/approval hooks, and fail-closed privileged execution.
- **`@axrail/artifacts`** — portable engineering artifact identity, versions, snapshots, providers.
- **`@axrail/changesets`** — structured engineering changes, operations, preconditions, risk metadata, immutable snapshots, and canonical SHA-256 digests.
- **`@axrail/validation`** — composable schema, semantic, domain, adapter, safety and post-execution validation stages.
- **`@axrail/policy`** — deny-overrides policy composition with default-deny behavior and deterministic obligations.
- **`@axrail/approval`** — approval requests, quorum/role requirements, expiration, evidence binding, and fail-closed provider behavior.
- **`@axrail/transactions`** — transaction state machine, immutable ChangeSet evidence, optimistic concurrency, atomic/compensating/best-effort executors, validation/policy/approval bridges, audit checkpoints, and explicit rollback.
- **`@axrail/events`** — observable runtime event envelopes, EventStore contracts, session lifecycle, correlation, replay, in-memory storage, and durable append-only JSONL storage.
- **`@axrail/adapter-sdk`** — vendor-neutral Adapter lifecycle, atomic mounting, provider binding, context providers, and capability manifests (`exact`, `compatible`, `degraded`, `unsupported`).
- **`@axrail/mcp`** — governed MCP Tool bridge plus official MCP TypeScript SDK v2 HTTP/stdio client integration, with descriptor refresh/reclassification.
- **`@axrail/agent`** — model-agnostic in-process Agent loop with append-only in-memory conversation history, sequential governed Tool execution, and provider-scoped Tool discovery.
- **`@axrail/model-openai-compatible`** — provider adapter for OpenAI-compatible Responses APIs, including DeepSeek-compatible endpoints.
- **`@axrail/hmi-adapter-kit`** — optional vendor-neutral HMI domain SDK built above `@axrail/adapter-sdk`; it is not a Harness/kernel dependency.
- **`@axrail/cli`** — read-only diagnostic CLI foundation for EventStore inspection and ChangeSet evidence digests.

`@axrail/core` remains in the monorepo as **experimental capability/plugin kernel research**. It is not currently proposed as part of the supported v0.1 public package set because RFC-0004 capability/plugin semantics have not yet been fully converged with the working `@axrail/harness` / AdapterHost composition model.

The original v0.1 functional scope is implemented, but package build/publish surfaces and versioning are still pre-release work. See [v0.1 Release Readiness](docs/release/v0.1-readiness.md) and the [proposed v0.1 Public API Surface](docs/release/v0.1-public-api.md).

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
- Axrail `@axrail/events` records **product runtime execution** such as Agent sessions, Tool execution, Policy decisions, Approval, Transaction state, Commit, Rollback, and authoritative audit checkpoints.

A CI run produced while developing `@axrail/transactions` can be referenced by `axrail-agent`; a customer's runtime `transaction.committed` event belongs to the Axrail application's EventStore, not the development repository.

## Vendor-neutral examples

### Hello Agent

[`examples/hello-agent`](examples/hello-agent/) is the smallest runnable example. It uses `HarnessRuntime`, a deterministic model, an L0 read Tool, and an L2 engineering-write Tool that requires approval.

```bash
pnpm --filter @axrail/example-hello-agent start
```

No API key or industrial hardware is required.

### HMI reference flow

HMI/SCADA is the first reference domain, not a dependency of the generic Harness runtime.

[`examples/hmi-agent`](examples/hmi-agent/) demonstrates a vendor-neutral path with no model API key and no proprietary HMI code. It uses `@axrail/hmi-adapter-kit` for HMI capability names, artifact references, Tool contracts, and capability manifests.

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

Multiple HMI/engineering Adapters may expose the same semantic Tool name. Axrail keeps semantic Tool identity separate from provider identity and fails closed when provider resolution is ambiguous.

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

MCP Tool annotations are treated as hints. Untrusted servers cannot lower Axrail's risk classification merely by declaring a Tool read-only. Same-name MCP Tool descriptor changes trigger re-registration and risk reclassification so stale trusted metadata cannot silently persist.

## Audit profiles

Harness deployments may choose:

```text
best_effort
required_before_effect
required_before_commit
```

Strict profiles persist authoritative `audit.effect.checkpoint` / `audit.commit.checkpoint` records before protected execution boundaries. Ordinary post-effect lifecycle events remain observational so an EventStore telemetry failure cannot falsely claim that an already-applied effect did not occur.

See [Audit Model](docs/audit-model.md).

## Safety boundary

Axrail software policy and approval are **not** substitutes for safety PLCs, interlocks, emergency stops, SIL/PL-rated safety functions, machine-controller safety logic, or regulated operating procedures.

Physical and safety-critical actions must remain constrained by deterministic controls outside the model.

## Architecture and RFCs

- [Architecture overview](docs/architecture/README.md)
- [Architecture and design](docs/architecture/design.md)
- [Audit model](docs/audit-model.md)
- [v0.1 Release Readiness](docs/release/v0.1-readiness.md)
- [Proposed v0.1 Public API Surface](docs/release/v0.1-public-api.md)
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
tests/          Cross-package behavioral tests
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
pnpm axrail --help
```

Useful diagnostic commands:

```bash
pnpm axrail events inspect ./events.jsonl --correlation work-order-42
pnpm axrail changeset digest ./changeset.json
```

The v0.1 CLI is intentionally read-only/diagnostic; it does not provide a privileged industrial side-effect bypass.

## Current priorities

The functional v0.1 scope and governed-execution P1 architecture gate are complete. Current release hardening focuses on:

- finalizing the proposed public package/API surface (#17);
- choosing the package build strategy and producing installable artifacts (#15);
- expanding compatibility/package smoke CI (#16);
- resolving or explicitly marking P2 architecture surfaces experimental (#20);
- versioning/changelog/release automation (#18).

## License

Apache-2.0. See [LICENSE](LICENSE).
