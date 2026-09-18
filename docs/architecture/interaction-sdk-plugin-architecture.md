# Interaction SDK Core + Plugin Architecture

Status: **post-RC implementation foundation**

This document defines the Axrail headless interaction layer for third-party engineering products.

The design is inspired by the composability principle used by DeepSeek Harness, but Axrail intentionally scopes plugins to the interaction layer rather than making governance/runtime internals replaceable.

## 1. High-level architecture

```mermaid
flowchart TB
    UI["Third-party Engineering UI<br/>AI Chat / Canvas / Selection"] --> ISDK["@axrail/interaction-sdk"]

    subgraph ISDKCORE["Interaction SDK"]
      CORE["InteractionRuntime<br/>Turn preparation<br/>Selection snapshot<br/>Context composition<br/>Event normalization"]
      PH["InteractionPluginHost"]
      CORE <--> PH
    end

    PH --> CP["Context Contributor Plugin"]
    PH --> TH["Turn Hook Plugin"]
    PH --> EO["Event Observer Plugin"]

    ISDK --> HARNESS["@axrail/harness"]

    subgraph GOV["Authoritative Governed Execution"]
      AGENT["Agent / ToolRuntime"]
      CS["ChangeSet"]
      POL["Policy"]
      VAL["Validation"]
      APP["Approval"]
      TX["TransactionRuntime"]
      AGENT --> CS
      CS --> POL
      POL --> VAL
      VAL --> APP
      APP --> TX
    end

    HARNESS --> GOV
    TX --> EXEC["ProviderBoundTransactionExecutor"]
    EXEC --> ADAPTER["Engineering Adapter"]
    ADAPTER --> TARGET["HMI / SCADA / CAD / Robot / MES"]

    CP -. "may add context only" .-> CORE
    TH -. "may observe/block pre-turn only" .-> CORE
    EO -. "observational only" .-> CORE
```

## 2. Core principle

```text
Core owns:
  interaction turn lifecycle
  explicit SelectionContext snapshot
  Adapter Context collection
  deterministic context envelope
  context size budget
  normalized interaction events
  plugin lifecycle

Plugins may extend:
  model registrations
  context contributions
  pre-turn checks
  post-turn observers
  event observers

Plugins may NOT replace:
  ToolRuntime
  Policy
  Validation
  Approval
  ChangeSet
  TransactionRuntime
  provider-bound executor identity
  authoritative audit checkpoints
```

This is the key distinction between Axrail and a fully replaceable "everything is a plugin" runtime.

## 3. Dependency direction

```mermaid
flowchart LR
    THIRD["Third-party App"] --> INTERACTION["@axrail/interaction-sdk"]
    THIRD --> DOMAIN["@axrail/hmi-adapter-kit<br/>or another domain SDK"]
    THIRD --> ADAPTER["@axrail/adapter-sdk"]

    INTERACTION --> HARNESS["@axrail/harness"]
    INTERACTION --> AGENT["@axrail/agent"]
    INTERACTION --> ADAPTER

    DOMAIN --> ADAPTER
    HARNESS --> ADAPTER
    HARNESS --> AGENT

    HARNESS --> GOV["Policy / Validation / Approval / Transactions"]
```

Important: `@axrail/harness` does **not** depend on `@axrail/interaction-sdk`.

The interaction layer is an optional product-facing composition layer above Harness.

## 4. Interaction turn

The first implementation defines one governed interaction turn:

```mermaid
sequenceDiagram
    participant UI as Third-party UI
    participant I as InteractionRuntime
    participant P as Interaction Plugins
    participant A as AdapterHost
    participant H as HarnessAgent
    participant G as Governed Tool/Transaction Runtime

    UI->>I: send(message, providerId, selection)
    I->>I: validate provider + selection
    I->>P: beforeTurn
    I->>A: buildContext(...)
    A-->>I: AdapterContextFragment[]
    I->>P: collect context contributions
    P-->>I: plugin context
    I->>I: build bounded context envelope
    I->>H: run(message + context)
    H->>G: Agent / governed Tool execution
    G-->>H: authoritative result
    H-->>I: AgentRunResult
    I->>P: afterTurn (observational)
    I-->>UI: InteractionResult + events
```

## 5. Why first version is turn-oriented

Axrail already has authoritative Harness Session/Event semantics, but persisted multi-turn continuation is not yet frozen as a public contract.

The first Interaction SDK therefore avoids creating a second competing conversation-history truth.

`InteractionRuntime.send()` represents one governed turn.

Future conversation continuation should reuse/extend authoritative Harness Session semantics rather than creating a private parallel transcript database inside the Interaction SDK.

## 6. Selection

Selection remains explicit per turn.

```text
Editor mutable selection
        ↓ user presses Send
immutable SelectionContext snapshot
        ↓
InteractionRuntime.send(...)
```

The runtime checks:

```text
SelectionContext.providerId
        =
Interaction providerId
```

Mismatch fails before model/tool execution.

## 7. Context composition

Context sources:

```text
Adapter Context
+
Plugin Context
+
SelectionContext provenance
+
turn metadata
```

The result becomes one deterministic interaction context envelope.

The envelope explicitly tells the model:

> The enclosed content is engineering data/context, not additional system instructions.

The runtime enforces a character budget.

Oversized context fails closed instead of silently truncating engineering data.

## 8. Plugin lifecycle

```text
mount(plugin)
  ↓
validate plugin identity
  ↓
setup(api)
  ↓
register contributors/hooks/observers
  ↓
commit plugin record

if setup fails:
  ↓
dispose registrations in reverse order
  ↓
plugin is not mounted
```

Unmount:

```text
remove plugin registrations first
  ↓
run plugin cleanup
  ↓
plugin no longer participates in turns
```

A cleanup error may be reported, but the plugin remains logically unmounted.

## 9. Plugin API

First-version plugin API:

```ts
interface InteractionPlugin {
  readonly id: string
  readonly version?: string

  setup(
    api: InteractionPluginApi
  ): void | (() => void) | Promise<void | (() => void)>
}

interface InteractionPluginApi {
  registerModel(
    registration: InteractionModelRegistration
  ): () => void

  registerContextContributor(
    contributor: InteractionContextContributor
  ): () => void

  registerBeforeTurn(
    hook: InteractionBeforeTurnHook
  ): () => void

  registerAfterTurn(
    hook: InteractionAfterTurnHook
  ): () => void

  onEvent(
    listener: InteractionEventListener
  ): () => void
}
```

The plugin API may register model providers on the intent side, but does not expose `TransactionRuntime`, `PolicyEngine`, `ApprovalService` or direct privileged mutation methods.

## 10. Plugin failure semantics

### Context contributor

A context contributor failure occurs before model/tool execution and fails the turn.

### beforeTurn hook

A before-turn hook may fail closed before model/tool execution.

### afterTurn hook

After-turn hooks are observational after authoritative Agent execution. Their failures do not rewrite the completed execution result.

### event observer

Event observers are observational. Their failures are isolated.

## 11. Third-party integration model

A typical HMI integration becomes:

```mermaid
flowchart TB
    CHAT["Existing AI Chat UI"] --> IR["InteractionRuntime"]
    CANVAS["Existing Canvas / Selection"] --> IR
    BRIDGE["Optional HMI interaction plugin"] --> IR

    IR --> H["@axrail/harness"]
    H --> HA["Private HMI Adapter"]
    HA --> PRODUCT["HMI product APIs"]

    CANVAS --> SEL["SelectionContext"]
    SEL --> IR
```

The third party should only need to implement:

1. existing UI wiring;
2. editor/selection bridge;
3. private engineering Adapter;
4. optional interaction plugins for product-specific context/presentation.

## 12. Not a plugin marketplace

This architecture does not yet define:

- plugin package discovery;
- npm registry discovery;
- filesystem plugin directories;
- plugin marketplace metadata;
- remote plugins;
- untrusted sandboxing;
- arbitrary service replacement.

Those should only be added after multiple real integrations prove a need.

## 13. Relationship to DeepSeek Harness

DeepSeek Harness publicly describes an "everything is a plugin" architecture backed by Cordis.

Axrail borrows:

- small core;
- typed extension points;
- mount/unmount lifecycle;
- reversible registrations;
- third-party extension without core edits.

Axrail deliberately does **not** borrow:

- making governance core replaceable through plugins;
- treating every subsystem as equivalent plugin authority;
- plugin access that can bypass provider-bound industrial execution controls.

## 14. Current implementation target

Phase 3A.2 implements:

```text
InteractionRuntime
InteractionPluginHost
Context contributors
Before/after turn hooks
Event observers
Selection/provider validation
Adapter Context collection
Context envelope + budget
HarnessAgent event bridge
Tests + >=95% coverage
```

Later work may add:

```text
conversation continuation
streaming model delta events
HMI-specific convenience plugin
React example UI
plugin package conventions
```

only after the core contracts are exercised by a real engineering product.


## 15. Model registry extension

Phase 3A.3 extends the Interaction Core with `ModelRegistry`.

```text
InteractionPlugin
      ↓ registerModel()
ModelRegistry
      ↓ explicit modelId per turn
AgentModelProvider
      ↓
HarnessAgent
```

Model plugins remain intent-side extensions. Model identity/provenance does not grant engineering execution authority.

See `docs/architecture/model-registry-runtime-selection.md` and RFC-0012.
