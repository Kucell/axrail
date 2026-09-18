# Axrail

[English](README.md) | [简体中文](README.zh-CN.md)

**Transactional AI execution for industrial and engineering software.**

Axrail is open-source harness infrastructure for AI agents that safely understand, modify, validate, and execute engineering workflows. It is intentionally independent of any vendor or private HMI implementation.

> Axrail puts a governed execution boundary between model intent and engineering side effects.

## Runtime support

Axrail v0.1 targets **Node.js 20 or newer** and is **ESM-only**. Public packages expose ESM `import` entry points; CommonJS `require()` entry points are not part of the v0.1 supported surface.

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

The implemented v0.1 foundation includes:

- **`@axrail/harness`** — primary high-level composition root that binds adapters, tools, policy, approval, events, sessions, agents, transactions, provider-aware Tool routing, and explicit audit profiles into an embeddable Harness runtime.
- **`@axrail/tools`** — governed Tool registry/execution, immutable Tool invocation evidence, provider-aware semantic Tool resolution, L0-L5 risk metadata, policy/approval hooks, explicit timeout/effect-uncertainty semantics, postcondition uncertainty handling, and fail-closed privileged execution.
- **`@axrail/artifacts`** — portable engineering artifact identity, versions, snapshots, providers.
- **`@axrail/changesets`** — structured engineering changes, operations, preconditions, risk metadata, immutable snapshots, and canonical SHA-256 digests.
- **`@axrail/validation`** — composable schema, semantic, domain, adapter, safety and post-execution validation stages with provider-aware Adapter scoping.
- **`@axrail/policy`** — deny-overrides policy composition with default-deny behavior and deterministic obligations.
- **`@axrail/approval`** — approval requests, quorum/role requirements, expiration, evidence binding, and fail-closed provider behavior.
- **`@axrail/transactions`** — transaction state machine, immutable ChangeSet evidence, optimistic concurrency, atomic/compensating/best-effort executors, validation/policy/approval bridges, audit checkpoints, and explicit rollback.
- **`@axrail/events`** — observable runtime event envelopes, EventStore contracts, session lifecycle, correlation, replay, in-memory storage, and durable append-only JSONL reference storage.
- **`@axrail/adapter-sdk`** — vendor-neutral Adapter lifecycle, atomic mounting, provider binding, explicit context retrieval, capability manifests, and documented experimental advanced composition subpaths.
- **`@axrail/mcp`** — governed MCP Tool bridge plus official MCP TypeScript SDK v2 HTTP/stdio client integration, with descriptor refresh/reclassification.
- **`@axrail/agent`** — model-agnostic in-process Agent loop with append-only in-memory conversation history, sequential governed Tool execution, failure-batch control, provider-scoped Tool discovery, and observational event isolation by default.
- **`@axrail/model-openai-compatible`** — provider adapter for OpenAI-compatible Responses APIs, including DeepSeek-compatible endpoints.
- **`@axrail/hmi-adapter-kit`** — optional vendor-neutral HMI domain SDK built above `@axrail/adapter-sdk`; it is not a Harness/kernel dependency.
- **`@axrail/cli`** — read-only diagnostic CLI for EventStore inspection and ChangeSet evidence digests.

`@axrail/core` remains in the monorepo as **experimental capability/plugin kernel research**. It is private and not part of the supported v0.1 public package set. The supported composition model is `@axrail/harness` + `AdapterHost`; RFC-0004 is exploratory rather than a requirement to introduce a second runtime kernel.

## Release candidate status

The supported v0.1 package/API surface, TypeScript project-reference build strategy, lockstep version policy, final architecture Gate, and post-RC hardening are complete.

All 15 supported public packages are published to npm as:

```text
0.1.0-rc.1
```

using the `rc` dist-tag with GitHub Actions provenance. The published artifacts correspond to source commit:

```text
e4758656c20f6cb90b05eb3429c79010667a2f7d
```

CI verifies on Node 20, 22, and 24:

```text
frozen install
  ↓
source type-check
  ↓
tsc -b ESM + declarations
  ↓
73 behavioral tests
  ↓
package dependency-closure audit
  ↓
pack 15 package tarballs
  ↓
clean npm consumer install
  ↓
runtime import every public package
  ↓
runtime import documented Adapter SDK advanced subpaths
  ↓
strict NodeNext TypeScript consumer compile
  ↓
packaged axrail --version
```

The npm RC packages are public. The annotated `v0.1.0-rc.1` Git tag and GitHub prerelease are finalized separately after registry verification.

See [v0.1 Release Readiness](docs/release/v0.1-readiness.md), [v0.1 Public API Surface](docs/release/v0.1-public-api.md), [Execution Boundary Semantics](docs/execution-semantics.md), and [Release Hardening](docs/release/README.md).



## Post-RC main additions

Current `main` contains experimental/pre-stable work that is **newer than the published 15-package npm `0.1.0-rc.1` artifact**:

- **Provider-bound Transactional Mutation** — high-level `HarnessRuntime.executeChangeSet()`.
- **Selection Context** — explicit provider-scoped click/multi/region selection contracts for engineering editors.
- **`@axrail/interaction-sdk`** — optional headless AI interaction core with bounded Context composition, normalized events, typed/reversible Interaction Plugins, and Model Registry / runtime model selection.

`@axrail/interaction-sdk` follows a scoped Core + Plugin design inspired by small-core extensibility patterns, while Axrail governance remains non-overridable: Interaction Plugins cannot replace ToolRuntime, Policy, Validation, Approval, TransactionRuntime or provider-bound execution through the SDK contract.

See [Interaction SDK Core + Plugin Architecture](docs/architecture/interaction-sdk-plugin-architecture.md), [RFC-0010](rfcs/0010-interactive-selection-context/README.md), and [RFC-0011](rfcs/0011-interaction-sdk-plugin-model/README.md).

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

For a real AI-native HMI/configuration product handoff, see the [AI-native HMI Integration Guide](docs/integrations/ai-native-hmi/README.md) and its [integration feedback template](docs/integrations/ai-native-hmi/feedback-template.md). The guide targets post-RC `main` and explicitly distinguishes the provider-bound high-level mutation API from the already published `0.1.0-rc.1` artifact.

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

`best_effort` is the default development/embedded profile, not a production safety recommendation. For deployment, physical-action, safety-sensitive, regulated, or otherwise audit-dependent environments, select an explicit strict profile and provide an EventStore with durability properties appropriate to the application.

See [Audit Model](docs/audit-model.md).

## Safety boundary

Axrail software policy and approval are **not** substitutes for safety PLCs, interlocks, emergency stops, SIL/PL-rated safety functions, machine-controller safety logic, or regulated operating procedures.

Physical and safety-critical actions must remain constrained by deterministic controls outside the model.

## Architecture, release and RFCs

- [Architecture overview](docs/architecture/README.md)
- [Architecture and design](docs/architecture/design.md)
- [AI-native HMI Integration Guide](docs/integrations/ai-native-hmi/README.md)
- [HMI Integration Feedback Template](docs/integrations/ai-native-hmi/feedback-template.md)
- [Execution boundary semantics](docs/execution-semantics.md)
- [Audit model](docs/audit-model.md)
- [Release hardening](docs/release/README.md)
- [v0.1 Release Readiness](docs/release/v0.1-readiness.md)
- [v0.1 Public API Surface](docs/release/v0.1-public-api.md)
- [RFC-0001: Artifact Model](rfcs/0001-artifact-model/README.md)
- [RFC-0002: ChangeSet Protocol](rfcs/0002-changeset-protocol/README.md)
- [RFC-0003: Transaction Runtime](rfcs/0003-transaction-runtime/README.md)
- [RFC-0004: Capability & Plugin Model](rfcs/0004-capability-plugin-model/README.md)
- [RFC-0005: Tool Runtime & Risk Model](rfcs/0005-tool-runtime-risk-model/README.md)
- [RFC-0006: Adapter Protocol](rfcs/0006-adapter-protocol/README.md)
- [RFC-0007: Policy & Approval Model](rfcs/0007-policy-approval-model/README.md)
- [RFC-0008: Event & Session Model](rfcs/0008-event-session-model/README.md)
- [RFC-0009: Transactional Mutation Pipeline](rfcs/0009-transactional-mutation/README.md)
- [RFC-0010: Interactive Selection Context](rfcs/0010-interactive-selection-context/README.md)
- [RFC-0011: Headless Interaction SDK and Plugin Model](rfcs/0011-interaction-sdk-plugin-model/README.md)
- [RFC-0012: Model Registry and Runtime Model Selection](rfcs/0012-model-registry-runtime-selection/README.md)

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
pnpm pack:smoke
pnpm axrail --help
```

Useful diagnostic commands:

```bash
pnpm axrail events inspect ./events.jsonl --correlation work-order-42
pnpm axrail changeset digest ./changeset.json
```

The v0.1 CLI is intentionally read-only/diagnostic; it does not provide a privileged industrial side-effect bypass.

## Current priorities

The v0.1 runtime/release foundation and first npm bootstrap publication are complete. Current engineering priority is now:

```text
Architecture Convergence
  ↓
Transactional Mutation
  ↓
Real HMI Adapter validation
  ↓
Engineering Runtime
  ↓
Second Adapter validation
  ↓
v0.2 stabilization
```

RC1 operational closeout continues in parallel: configure stage-only Trusted Publishers and finalize the exact `v0.1.0-rc.1` GitHub tag/prerelease from provenance commit `e4758656c20f6cb90b05eb3429c79010667a2f7d`. The one-time bootstrap npm credential is temporarily retained by maintainer decision and is not the intended mechanism for subsequent releases.

## License

Apache-2.0. See [LICENSE](LICENSE).

## v0.2 runtime and model-provider direction

Post-RC/v0.2 development raises the minimum runtime to **Node.js 22.13+** and changes the CI compatibility matrix to Node 22 / 24 / 26.

For model vendors, the preferred path is now:

```text
@axrail/interaction-sdk ModelRegistry
        ↓
AgentModelProvider
        ▲
@axrail/model-ai-sdk
        ↓
Vercel AI SDK
        ↓
provider package / private LanguageModel
```

This keeps Axrail focused on governed engineering execution instead of maintaining vendor HTTP protocols. Vercel AI SDK is provider infrastructure only; Axrail AgentLoop/ToolRuntime remains authoritative and AI SDK Tool definitions are not given execute handlers.

`@axrail/model-openai-compatible` remains as a lightweight/reference compatibility path.

See [Model Provider Convergence on Vercel AI SDK](docs/architecture/model-provider-ai-sdk-convergence.md) and [RFC-0013](rfcs/0013-ai-sdk-provider-convergence/README.md).

The published npm `0.1.0-rc.1` remains the historical Node >=20, 15-package release and is not retroactively changed by this v0.2 work.

## Current npm integration baseline

For real HMI / engineering-product integration, use the published prerelease:

```text
Axrail 0.2.0-alpha.1
npm dist-tag: next
Node.js >=22.13.0
17 public packages
```

The two packages newly introduced after RC1 are `@axrail/interaction-sdk` and `@axrail/model-ai-sdk`, but all 17 public packages are published at `0.2.0-alpha.1`.

An npm package page may still show `0.1.0-rc.1` as its default visible version because the alpha release uses `next` and intentionally does not move `latest` or overwrite `rc`.

Recommended integration install:

```bash
pnpm add \
  @axrail/harness@0.2.0-alpha.1 \
  @axrail/interaction-sdk@0.2.0-alpha.1 \
  @axrail/model-ai-sdk@0.2.0-alpha.1 \
  @axrail/hmi-adapter-kit@0.2.0-alpha.1 \
  @axrail/adapter-sdk@0.2.0-alpha.1
```

See the [AI-native HMI Integration Guide](docs/integrations/ai-native-hmi/README.md) for npm dist-tag verification, model-provider setup and integration boundaries.
