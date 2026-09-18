# Architecture

Axrail separates Agent intent from governed execution. Durable engineering changes should converge on explicit ChangeSet + Transaction semantics, while Adapters provide vendor/domain-specific execution boundaries.

## Documents

- [Architecture and Design](design.md) — current implemented composition model, execution boundaries, package architecture, Adapter/MCP/HMI boundaries, Transactional Mutation direction, and updated roadmap.
- [RFC-0009 Transactional Mutation Pipeline](../../rfcs/0009-transactional-mutation/README.md) — convergence path from governed Tool intent to ChangeSet + Transaction execution.
- [Interactive Selection and Scoped HMI Editing](interactive-selection-scoped-editing.md) — product-owned canvas interaction with explicit Axrail Selection Context and governed scoped editing.
- [Interaction SDK Core + Plugin Architecture](interaction-sdk-plugin-architecture.md) — headless product-facing interaction core with typed, reversible plugins above Harness governance.
- [Model Registry and Runtime Model Selection](model-registry-runtime-selection.md) — explicit model registration, per-turn switching, capabilities and provenance while Harness stays model-agnostic.
- [RFC-0010 Interactive Selection Context](../../rfcs/0010-interactive-selection-context/README.md) — vendor-neutral selection snapshot and HMI scoped-editing boundary.

## Current runtime model

```text
HarnessRuntime
    │
    ├── Agent
    ├── ToolRuntime
    ├── AdapterHost
    ├── TransactionRuntime
    ├── EventStore / Sessions
    ├── Policy
    ├── Validation
    └── Approval
```

`HarnessRuntime` + `AdapterHost` is the supported composition model.

`@axrail/core` remains private/experimental capability/plugin research and is not the supported runtime kernel.

## Governed execution model

```text
Agent / Human Intent
        ↓
Governed Tool / Change Proposal
        ↓
ChangeSet
        ↓
Transaction
   ├─ Policy
   ├─ Validation
   ├─ Approval
   └─ Audit
        ↓
Adapter / MCP
        ↓
Controlled Effect
        ↓
Commit / Rollback / Explicit Uncertainty
```

For durable L2/L3 engineering mutations, the roadmap direction is to make ChangeSet + Transaction the normal execution path rather than allow direct Tool effects to become a parallel privileged mutation architecture.

## RFCs

1. [RFC-0001 Artifact Model](../../rfcs/0001-artifact-model/README.md)
2. [RFC-0002 ChangeSet Protocol](../../rfcs/0002-changeset-protocol/README.md)
3. [RFC-0003 Transaction Runtime](../../rfcs/0003-transaction-runtime/README.md)
4. [RFC-0004 Capability & Plugin Model](../../rfcs/0004-capability-plugin-model/README.md) — exploratory; generic kernel is not on the supported runtime path.
5. [RFC-0005 Tool Runtime & Risk Model](../../rfcs/0005-tool-runtime-risk-model/README.md)
6. [RFC-0006 Adapter Protocol](../../rfcs/0006-adapter-protocol/README.md) — implemented foundation; advanced transaction semantics under convergence.
7. [RFC-0007 Policy & Approval Model](../../rfcs/0007-policy-approval-model/README.md)
8. [RFC-0008 Event & Session Model](../../rfcs/0008-event-session-model/README.md)
9. [RFC-0009 Transactional Mutation Pipeline](../../rfcs/0009-transactional-mutation/README.md) — current post-RC transactional mutation foundation.
10. [RFC-0010 Interactive Selection Context](../../rfcs/0010-interactive-selection-context/README.md) — explicit provider-scoped selection snapshots for scoped engineering editing.
11. [RFC-0011 Headless Interaction SDK and Plugin Model](../../rfcs/0011-interaction-sdk-plugin-model/README.md) — reusable AI interaction core with a constrained plugin extension surface.
12. [RFC-0012 Model Registry and Runtime Model Selection](../../rfcs/0012-model-registry-runtime-selection/README.md) — reusable model picker/selection/capability/provenance contract for the Interaction layer.

## Current architecture workstream

The v0.1 foundation is implemented and published. Architecture work now prioritizes convergence and real integration rather than adding broad speculative infrastructure.

Recommended order:

1. **Architecture Convergence** — keep Harness/AdapterHost as the real composition model; keep `@axrail/core` experimental; align RFCs and docs.
2. **Transactional Mutation** — connect governed Tool/change proposals to ChangeSet + Transaction through a high-level Harness path.
3. **HMI interaction readiness + Real HMI Adapter** — standardize explicit Selection Context/scoped editing first, then validate executor selection, preview, Validation, Policy, Approval, commit/rollback and Context semantics with a real AI-native HMI integration.
4. **Engineering Runtime** — add Context Assembly, engineering Skills, durable EventStore providers and recovery/resume semantics after the mutation path is proven.
5. **Second Adapter validation** — use a substantially different engineering integration to ensure the protocol is not HMI-specific.
6. **v0.2 stabilization** — freeze the next Adapter, transactional mutation, Context and Harness high-level execution contracts.

Deferred until the execution protocol matures:

```text
complex multi-agent orchestration
cloud control plane
vector database platform
GUI studio
plugin marketplace
adapter marketplace
skill marketplace
```

HMI remains the first reference domain, not a generic Harness dependency.

## v0.2 model-provider convergence

- [Model Provider Convergence on Vercel AI SDK](model-provider-ai-sdk-convergence.md) — Node 22.13+ v0.2 baseline and the preferred bridge from Axrail AgentModelProvider to Vercel AI SDK LanguageModel.
- [RFC-0013 Vercel AI SDK Model Provider Convergence](../../rfcs/0013-ai-sdk-provider-convergence/README.md) — provider-protocol convergence without moving Tool execution or governance into the model SDK.

The post-RC/v0.2 compatibility matrix is Node 22 / 24 / 26. Published npm 0.1.0-rc.1 remains historical Node >=20.
