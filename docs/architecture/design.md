# Axrail Architecture and Design

> **Transactional AI execution for industrial and engineering software.**

Axrail is an open-source governed execution harness for AI agents that operate industrial and engineering software. It turns model intent into controlled engineering execution through explicit Tool governance, ChangeSets, Transactions, Policy, Validation, Approval, Audit, and Adapter boundaries.

Axrail is intentionally independent of any single HMI, SCADA, PLC, robotics, MES, CAD/CAE, or digital-twin product. Product-specific behavior belongs behind Adapter or domain SDK boundaries rather than inside the generic runtime.

## 1. Project positioning

Axrail is not an HMI product, a PLC IDE, an MCP server, or a generic chat-agent framework. It is the governed execution layer between AI agents and engineering software.

```text
                AI Models / Agents
        GPT / DeepSeek / Claude / Local
                         │
                         ▼
                ┌────────────────┐
                │     Axrail     │
                │ Governed       │
                │ Execution      │
                │ Harness        │
                └───────┬────────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
   HMI / SCADA         PLC             Robot
       │                │                │
       ▼                ▼                ▼
      MES            CAD / CAE      Digital Twin
```

Axrail's role is to turn unconstrained agent intent into explicit, reviewable and governed engineering execution.

## 2. Runtime architecture: the implemented composition model

The supported composition model is centered on `@axrail/harness` and `AdapterHost`.

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

`HarnessRuntime` is the primary embeddable composition root. `AdapterHost` owns the mounted engineering-system provider surfaces used by the Harness.

This is the implemented runtime model. The earlier generic capability/plugin kernel research in `@axrail/core` is **not** the supported runtime composition root.

### `@axrail/core` status

`@axrail/core` remains:

```text
private
experimental
internal
```

It contains capability/plugin/scope research associated with RFC-0004. It is intentionally not a public v0.1 package and the working Harness does not depend on it.

Axrail will not reactivate a generic plugin kernel merely to match an earlier architecture sketch. RFC-0004 will evolve from real Adapter/Harness requirements. If a generic capability kernel later proves necessary, it must reduce concrete integration complexity rather than introduce an additional abstraction layer without a demonstrated need.

## 3. Core execution model

The fundamental execution model is:

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
   └─ Audit checkpoints
        ↓
Adapter / MCP boundary
        ↓
Controlled Effect
        ↓
Commit / Rollback / Explicit Uncertainty
```

A model must not jump directly from intent to a privileged side effect. Important engineering mutations should become explicit data before commit.

### Intent

Intent is the objective expressed by a human, Agent, application, or upstream planner. It remains an Agent/application concept rather than a standalone public Axrail package.

Examples:

- Create a robot monitoring page.
- Change an HMI control binding.
- Update a PLC configuration.
- Modify a robot program.
- Deploy an engineering project.

### Governed Tool

A Tool is the callable semantic boundary visible to an Agent. Tool execution performs provider resolution, immutable invocation evidence construction, risk classification, Policy, Approval, obligations, audit checkpoints, timeout handling, and result validation.

Read operations may complete directly through Tool execution. Engineering mutation Tools should increasingly produce or operate through ChangeSets and Transactions rather than becoming an alternate privileged mutation path.

### ChangeSet

A ChangeSet is a structured proposal describing what should change and why.

A ChangeSet is portable data. It should be inspectable, diffable, versionable, auditable, and suitable for preview before execution.

```yaml
kind: ChangeSet
artifact:
  ref: hmi://factory-a/main-project
operations:
  - op: create
    target: screen
    value:
      name: Robot Overview
reason: Create a robot monitoring screen
```

### Transaction

A Transaction is the governed execution boundary for applying a ChangeSet.

```text
create
  ↓
prepare
  ↓
policy
  ↓
validate
  ↓
approve
  ↓
apply
  ↓
verify
  ↓
commit
```

On recoverable failure:

```text
rollback / compensation
```

If an external side effect has an unknown outcome, Axrail must represent that as explicit uncertainty rather than falsely claiming that no effect occurred.

## 4. Transactional mutation policy

Axrail v0.1 permits governed Tool execution outside a Transaction where the Tool contract and Policy allow it. The post-RC architecture direction narrows the preferred mutation path.

Default design direction:

```text
L0  read/query
    → governed Tool execution

L1  local or draft mutation
    → governed Tool; Transaction optional by contract/policy

L2  engineering modification
    → ChangeSet + Transaction by default

L3  deploy/overwrite engineering state
    → Transaction required by default

L4  physical action
    → explicit command/effect model + approval + deterministic safety boundary
    → do not assume every physical action is rollback-capable

L5  safety critical
    → explicit Transaction boundary + approval + deployment opt-in
    → deterministic safety systems remain authoritative
```

This is a direction for the next protocol iteration, not a retroactive change to the already published v0.1 API.

The purpose is to remove ambiguity between two privileged mutation paths:

```text
Tool → direct effect
```

and:

```text
Tool / Intent → ChangeSet → Transaction → effect
```

For durable engineering changes, the second path should become the normal path.

## 5. First-class domain concepts

Axrail treats the following concepts as first-class runtime primitives.

### Artifact

An Artifact is an engineering asset being understood or modified by an agent.

Examples:

- HMI project
- PLC project
- Robot program
- MES workflow
- Recipe
- CAD model
- Engineering configuration
- Automation script

The generic runtime does not need to understand every domain-specific artifact semantic. Adapter and domain SDK contracts expose the required capabilities.

### ChangeSet

Represents proposed changes to one or more Artifacts.

### Transaction

Coordinates governed execution, optimistic concurrency, validation, approval, commit, compensation/rollback, and explicit failure states.

### Tool

A callable semantic capability exposed through the governed Tool Runtime.

### Adapter

A vendor-neutral boundary through which external engineering systems expose Tool, Artifact, Validation, Policy, Context and transaction-related capabilities.

### Event

An append-only record of meaningful runtime activity such as a Tool request, Policy decision, Approval, validation result, audit checkpoint, rollback, or commit.

## 6. Package architecture

The supported public package graph is layered.

```text
Foundation
  approval
  artifacts
  events
  policy
  tools
  validation

Protocol / orchestration primitives
  changesets
  agent
  mcp
  transactions
  model-openai-compatible
  cli

Integration layer
  adapter-sdk

Domain / composition layer
  hmi-adapter-kit
  harness

Optional product interaction layer
  interaction-sdk
```

### `@axrail/harness`

Primary application/runtime composition root. It binds AdapterHost, ToolRuntime, Agent execution, TransactionRuntime, Policy, Approval, Validation, Sessions, EventStore, and audit profiles.

### `@axrail/adapter-sdk`

Primary engineering-system integration SDK. It owns Adapter lifecycle, provider binding/scoping, capability manifests, explicit context retrieval, and experimental advanced transaction/approval surfaces.

### `@axrail/tools`

Governed Tool contracts, registry/resolution, invocation evidence, risk metadata, Policy and Approval integration, obligations, timeout/effect uncertainty, and result validation semantics.

### `@axrail/transactions`

ChangeSet execution lifecycle, optimistic concurrency, Policy/Approval bridges, Validation, apply/verify/commit/rollback semantics, and Transaction state.

### `@axrail/agent`

A deliberately thin model-facing Agent loop. It discovers Tools and delegates execution to ToolRuntime rather than reimplementing governance.

### `@axrail/mcp`

MCP interoperability. MCP Tools are normalized into Axrail Tool governance and do not bypass Policy, Approval, audit or risk classification.

### `@axrail/hmi-adapter-kit`

Optional vendor-neutral HMI domain SDK built above generic Axrail packages. It must not become a dependency of the generic Harness runtime.

### `@axrail/interaction-sdk`

Post-RC optional headless product-facing interaction layer above Harness. It owns interaction-turn preparation, explicit Selection/Adapter Context composition, bounded context envelopes, UI-facing event normalization and an interaction-scoped typed plugin host.

It is intentionally **not** a new Axrail-wide plugin kernel. Interaction plugins cannot replace or bypass ToolRuntime, Policy, Validation, Approval, ChangeSet, TransactionRuntime, provider-bound execution or authoritative audit boundaries.

### `@axrail/core`

Private experimental capability/plugin research only. It is excluded from the supported public package graph.

## 7. Tool execution pipeline

Tools are not executed directly by the model.

```text
Tool Call
   ↓
Resolve Tool / Provider
   ↓
Validate Input
   ↓
Build immutable invocation evidence
   ↓
Classify Risk
   ↓
Evaluate Policy
   ↓
Enforce obligations
   ↓
Request Approval when required
   ↓
Authoritative audit checkpoint when configured
   ↓
Execute
   ↓
Validate Result
   ↓
Emit lifecycle events
```

Unknown Policy obligations fail closed. Privileged operations fail closed when required Policy or Approval infrastructure is unavailable.

## 8. Risk model

| Level | Meaning | Examples |
| --- | --- | --- |
| L0 | Read only | Query tags, inspect project, read metadata |
| L1 | Local modification | Move a UI component, modify local draft data |
| L2 | Engineering modification | Change bindings, scripts, PLC/HMI engineering configuration |
| L3 | Deployment | Deploy or overwrite an engineering runtime/project |
| L4 | Physical action | Start motor, change live machine state, issue runtime command |
| L5 | Safety critical | Safety PLC changes or safety-related machine actions |

Risk level alone does not determine safety. Adapters and deployment environments may apply stronger Policy rules.

Software Policy/Approval is not a substitute for safety PLCs, interlocks, emergency stops, SIL/PL-rated controls, controller safety logic, or regulated procedures.

## 9. Adapter architecture

Adapters connect Axrail to engineering systems.

A generic Adapter may expose:

```ts
interface AxrailAdapter {
  id: string
  version: string

  capabilities(): Promise<CapabilityManifest>
  tools?(): ToolDefinition[]
  artifacts?(): ArtifactProvider
  context?(): AdapterContextProvider[]
  validators?(): Validator[]
  policies?(): PolicyProvider[]
  approvals?(): ApprovalProvider[]
  transactions?(): AdapterTransactionParticipant
}
```

`AdapterHost` mounts these surfaces and binds provider identity so multiple engineering systems can coexist without ambiguous implicit routing.

### Explicit Adapter scoping

Context retrieval is explicit by Adapter ID. Sensitive Context fragments remain excluded unless the application opts in. Axrail does not automatically inject arbitrary Adapter Context into model prompts.

### Experimental Adapter surfaces

Two v0.1 Adapter areas remain deliberately experimental:

- Adapter-provided Approval providers are discoverable but not automatically selected by Harness governance.
- `AdapterTransactionParticipant` exists, but multi-Adapter transaction participant orchestration is not frozen.

These semantics should be stabilized only after real Adapter integrations exercise them.

## 10. HMI as the first reference domain

HMI/SCADA remains the first major reference domain, not a dependency of the generic runtime.

A reference HMI Adapter may expose semantic Tools such as:

```text
hmi.project.inspect
hmi.screen.inspect
hmi.screen.create
hmi.component.add
hmi.component.update
hmi.binding.create
hmi.alarm.create
hmi.project.validate
hmi.preview
hmi.deploy
```

The open-source repository should contain vendor-neutral contracts, mock/reference integrations, and `@axrail/hmi-adapter-kit`. Proprietary product schemas and implementation stay outside the public runtime.

A commercial or private AI-native HMI can adopt Axrail through an Adapter without making Axrail dependent on that product.

## 11. MCP relationship

MCP is an interoperability protocol, not Axrail's internal domain model.

Preferred path:

```text
LLM / Agent
    ↓
Axrail Tool Runtime
    ↓
Risk / Policy / Approval / Audit
    ↓
Transaction when required
    ↓
MCP Bridge / Adapter
    ↓
Engineering System
```

Avoid for privileged engineering operations:

```text
LLM → MCP → live industrial effect
```

Untrusted MCP metadata must not be able to lower Axrail's effective risk classification or bypass governance.

## 12. Context and Skills direction

Context and Skills are engineering-runtime features, not reasons to turn Axrail into a general Agent platform.

### Context

Context should remain:

```text
explicit
provider-aware
scope-aware
sensitive-by-default-excluded
traceable
```

The next step is Context Assembly between explicit Adapter Context retrieval and a model request, with clear provenance and size/sensitivity controls.

### Skills

An Axrail Skill should mean a reusable governed engineering workflow, for example:

```text
create-hmi-overview
configure-alarm
migrate-screen
validate-engineering-project
deploy-project
```

Skills are not a generic prompt-personality or long-term-memory system.

## 13. Event and audit model

Axrail uses append-only Events for observability, reconstruction, audit and debugging.

Strict audit profiles use authoritative pre-effect or pre-commit checkpoints. Ordinary lifecycle telemetry is observational and must not retroactively change the truth of an already-applied external effect.

Reference JSONL storage is appropriate for embedded/reference use. Production deployments with stronger durability/compliance requirements should provide an EventStore with suitable guarantees.

## 14. Native and compatibility systems

AI-native engineering environments may implement the complete Axrail execution model.

Legacy or third-party software may support only subsets. Capability manifests should communicate support explicitly:

```text
exact
compatible
degraded
unsupported
```

This enables Agent/application logic to understand whether preview, rollback, validation, transactional commit, or other capabilities are truly available.

## 15. Design principles

### Governed execution first

The differentiator is not generic Tool calling; it is governed engineering execution.

### Harness as composition root

Applications embed `@axrail/harness`; domain integrations enter through Adapter boundaries.

### Transaction first for durable mutations

Important engineering mutations should converge on ChangeSet + Transaction semantics.

### Model agnostic

Model providers remain replaceable.

### Vendor agnostic

Engineering-system specifics stay behind Adapters/domain SDKs.

### Human governed

High-risk operations support explicit Approval and fail-closed behavior.

### Observable and auditable

Governance decisions and execution checkpoints are structured evidence.

### MCP compatible, not MCP dependent

MCP interoperability must not define the internal execution model.

### Safety boundaries before autonomy

Deterministic external safety controls remain authoritative.

### Avoid speculative infrastructure

Do not add generic plugin kernels, multi-agent systems, cloud control planes, vector platforms or marketplaces before concrete engineering execution requirements justify them.

## 16. Architecture convergence workstream

The post-RC architecture work begins with convergence rather than broad feature expansion.

### A. Align documents with the implemented runtime

- Treat `HarnessRuntime` + `AdapterHost` as the supported composition model.
- Keep `@axrail/core` private/experimental.
- Update RFC-0004 so capability/plugin concepts are optional infrastructure research rather than a presumed mandatory runtime center.

### B. Establish the Transactional Mutation pipeline

Define and implement a high-level path where durable engineering mutation naturally becomes:

```text
Agent Intent
  ↓
Tool / Change Proposal
  ↓
ChangeSet
  ↓
Preview
  ↓
Policy
  ↓
Validation
  ↓
Approval
  ↓
Transaction
  ↓
Adapter Executor
  ↓
Verify
  ↓
Commit / Rollback / Explicit Uncertainty
```

A likely Harness-level API direction is a high-level ChangeSet execution entry point so applications do not have to manually assemble TransactionRuntime infrastructure for normal governed engineering changes.

### C. Validate Adapter semantics with a real HMI integration

Use a real AI-native HMI Adapter to drive final decisions around:

- Transaction participant / executor selection;
- Context assembly;
- Adapter-level Validation and Policy;
- preview/commit/rollback capability semantics;
- degraded capability reporting;
- approval integration.

## 17. Updated roadmap

The previous feature-first roadmap is superseded by an execution-protocol-first roadmap.

### Phase 0 — RC1 closeout

```text
npm RC1 publication              ✓
provenance                       ✓
public package graph             ✓
GitHub prerelease                pending
Trusted Publisher migration      pending
bootstrap token                  temporarily retained by maintainer decision
```

The bootstrap token is not a normal future release mechanism. Subsequent publishing should still migrate to OIDC Trusted Publishing.

### Phase 1 — Architecture Convergence

Goals:

- synchronize architecture docs and RFCs with implemented Harness/AdapterHost reality;
- keep `@axrail/core` experimental rather than promote it prematurely;
- define the durable-mutation path and risk/transaction expectations;
- identify public contracts that remain experimental.

Deliverables:

```text
design.md convergence
RFC-0004 revision
RFC-0006 Adapter protocol review
Transactional Mutation architecture/RFC
```

### Phase 2 — Transactional Mutation

Goals:

- make ChangeSet + Transaction the normal path for durable engineering writes;
- reduce manual TransactionRuntime assembly in applications;
- formalize preview/apply/verify/commit/rollback semantics;
- retain explicit uncertainty for effects that cannot be proven absent.

Potential deliverables:

```text
Harness high-level ChangeSet API
transaction-required mutation semantics
executor resolution
preview contract
end-to-end governance tests
```

### Phase 3 — Real HMI Adapter

Use a real AI-native HMI integration to validate the generic contracts.

Target vertical slice:

```text
inspect project
  ↓
inspect/select screen
  ↓
create or modify screen/component
  ↓
produce ChangeSet
  ↓
validate
  ↓
preview
  ↓
approve
  ↓
commit
  ↓
rollback / recovery test
```

The private/commercial HMI implementation remains outside the public repository. The public repository retains only vendor-neutral contracts and reference examples.

### Phase 4 — Engineering Runtime

After the real Adapter validates the mutation pipeline:

```text
Context Assembly
Engineering Skills
Durable EventStore implementations
Recovery/resume semantics
Advanced Adapter SDK
```

### Phase 5 — Adapter Ecosystem Validation

Add a second substantially different integration to prove that HMI did not distort the generic protocol. Candidates include:

```text
OPC UA
robot engineering/programming system
legacy HMI/SCADA
PLC engineering integration
```

The goal is protocol validation, not Adapter count.

### Phase 6 — v0.2 stabilization

Freeze the next generation of:

```text
Adapter contract
transactional mutation contract
Context contract
ChangeSet/Transaction integration
Harness high-level execution API
```

Then prepare the v0.2 release candidate.

### Deferred until protocol maturity

```text
complex multi-agent orchestration
cloud control plane
vector database platform
GUI studio
plugin marketplace
adapter marketplace
skill marketplace
```

These may become ecosystem features later, but they are not current core milestones.

## 18. RFC priorities

The existing RFC sequence remains useful, but current priority is not equal across all RFCs.

Immediate architecture priority:

```text
RFC-0004 — Capability & Plugin Model
  revise to reflect Harness/AdapterHost reality

RFC-0006 — Adapter Protocol
  review executor selection, transaction participation and preview semantics from real integrations before any public stabilization

RFC-0002 — ChangeSet Protocol
RFC-0003 — Transaction Runtime
RFC-0005 — Tool Runtime & Risk Model
  review together for Transactional Mutation convergence
```

RFC-0007 and RFC-0008 remain important governance/evidence foundations and should evolve when concrete integration needs require changes.

## 19. Long-term direction

The long-term objective is a reusable protocol and ecosystem for governed industrial AI execution.

The architecture should eventually make it natural to say:

```text
This engineering system exposes an Axrail Adapter.
This Agent proposes an Axrail ChangeSet.
This change executes through an Axrail Transaction.
This deployment requires Axrail Policy and Approval.
This external Tool is normalized through Axrail governance.
```

The short-term priority, however, is not ecosystem breadth. It is proving one complete and credible execution chain:

```text
real engineering context
  ↓
Agent intent
  ↓
ChangeSet
  ↓
Policy / Validation / Approval
  ↓
Transaction
  ↓
real Adapter
  ↓
commit / rollback / audit
```

Once that path is reliable across more than one engineering domain, broader ecosystem work becomes justified.


## 20. Interactive selection and scoped engineering editing

AI-native engineering editors frequently need an interaction loop where the user selects one or more objects on the canvas and then continues editing through natural language.

Axrail supports this without becoming an editor framework.

```text
Editor-owned interaction
click / multi / region / hit test
              ↓
stable engineering target IDs
              ↓
explicit SelectionContext
              ↓
Adapter Context / model-turn assembly
              ↓
Change Proposal / ChangeSet
              ↓
Policy / Validation / Approval
              ↓
Transaction
              ↓
provider-bound effect
```

The authoritative boundary is:

```text
Product owns:
  canvas
  hit testing
  selection overlays
  drag / resize
  zoom / transforms
  current UI selection state

Axrail owns:
  explicit selection snapshot contract
  provider and target provenance
  HMI selection normalization
  scoped Context transport
  governed mutation after ChangeSet creation
```

### Selection is explicit and request-scoped

`AdapterContextRequest` may carry a `SelectionContext` snapshot for the current request.

Axrail does not keep a hidden mutable global selection inside `HarnessRuntime`. The embedding product freezes the current editor selection when the AI request is created and passes that snapshot explicitly.

This reduces stale-selection and UI/request race ambiguity.

### Stable target identity beats pixel geometry

Region coordinates are useful evidence for layout reasoning and placement, but the HMI product performs hit testing and resolves existing engineering objects to stable IDs before passing them to Axrail.

Axrail must not infer durable engineering targets from pixels.

### Selection does not bypass governance

A selection narrows user intent. It is not approval, authorization, or a durable mutation.

Persistent changes still follow:

```text
Selection + user request
      ↓
ChangeSet
      ↓
Policy / Validation / Approval
      ↓
Transaction
      ↓
ProviderBoundTransactionExecutor
```

### HMI domain support

`@axrail/hmi-adapter-kit` provides the `hmi.selection.context` capability and helpers for:

- screen selection;
- single component selection;
- multi-component selection;
- region selection with resolved component IDs;
- blank-region selection for placement intent;
- normalized selection Context fragments.

See RFC-0010 and `docs/architecture/interactive-selection-scoped-editing.md`.

### Current Context Assembly limitation

Adapter Context retrieval is explicit. Current Harness/Agent does not automatically inject arbitrary Adapter Context into model prompts.

For the first real HMI integration, the embedding AI chat application should retrieve/normalize the current selection context and explicitly include the resulting fragments in the model turn.

A future Context Assembly layer can standardize provenance, sensitivity and budget-aware model input without changing the selection ownership boundary.


## 21. Headless interaction core and plugin extensions

Third-party engineering applications should not independently rebuild the same AI chat/context/selection glue.

Axrail therefore adds an optional product-facing layer:

```text
Third-party UI
  AI Chat / Canvas
        ↓
@axrail/interaction-sdk
  InteractionRuntime
  InteractionPluginHost
        ↓
@axrail/harness
        ↓
Agent / governed Tool / ChangeSet / Transaction
        ↓
Adapter
```

The interaction layer follows a constrained core + plugin model:

```text
Fixed Interaction Core
├─ turn lifecycle
├─ explicit selection
├─ Adapter Context
├─ context budget
├─ Harness Agent invocation
└─ normalized events

Typed Interaction Plugins
├─ context contributor
├─ before-turn hook
├─ after-turn observer
└─ event observer
```

The important invariant is:

```text
Interaction extensibility
        ≠
governance replaceability
```

See `docs/architecture/interaction-sdk-plugin-architecture.md` and RFC-0011.


## 22. Model registry and runtime model selection

Model integration remains layered:

```text
Third-party UI / Model Picker
          ↓
@axrail/interaction-sdk
  ModelRegistry
  explicit modelId per turn
  capability validation
  model provenance
          ↓
AgentModelProvider
          ↑
@axrail/model-* / third-party provider
          ↓
@axrail/agent
          ↓
@axrail/harness
          ↓
governed engineering execution
```

The ownership boundary is:

```text
@axrail/agent
  defines model-neutral request/response/provider protocol

@axrail/model-*
  implements concrete provider transport and credential resolution

@axrail/interaction-sdk
  registers/lists/selects models
  validates required capabilities
  emits model provenance

@axrail/harness
  remains model-agnostic
```

The first model-selection contract is deterministic:

```text
explicit send.modelId
      ↓
constructor defaultModelId
      ↓
single registered model
      ↓
otherwise fail closed
```

There is no silent fallback and no mutable global user model state.

Model identity is provenance only. It cannot lower Tool risk, bypass Approval, replace Policy/Validation, or alter provider-bound engineering effect identity.

Public model descriptors intentionally contain no credentials. API keys/tokens remain inside concrete model-provider configuration/resolvers.

See `docs/architecture/model-registry-runtime-selection.md` and RFC-0012.

## 23. Vercel AI SDK provider convergence

For v0.2, Axrail raises the post-RC runtime baseline to Node.js >=22.13.0 and stops treating vendor model HTTP protocols as a core maintenance responsibility.

```text
Interaction ModelRegistry
        ↓
AgentModelProvider
        ▲
@axrail/model-ai-sdk
        ↓
Vercel AI SDK LanguageModel
        ↓
application-selected provider package
```

`@axrail/agent` remains the stable model-neutral protocol. `@axrail/interaction-sdk` remains responsible for model selection/capability/provenance. `@axrail/harness` remains model-agnostic.

`@axrail/model-ai-sdk` executes exactly one model step. It supplies Tool schemas to AI SDK without execute handlers, so AI SDK can request Tools but cannot become a second engineering Tool runtime. Axrail AgentLoop and ToolRuntime remain authoritative for Policy, Approval, Audit and effects.

The existing `@axrail/model-openai-compatible` package remains as a lightweight/reference compatibility path. New model vendors should normally be integrated through the AI SDK bridge rather than new Axrail-maintained HTTP clients.

Runtime baseline:

```text
published RC1: Node >=20
post-RC / v0.2: Node >=22.13.0
CI: 22 / 24 / 26
```

See RFC-0013 and `docs/architecture/model-provider-ai-sdk-convergence.md`.
