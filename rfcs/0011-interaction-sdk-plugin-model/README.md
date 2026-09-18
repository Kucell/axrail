# RFC 0011: Headless Interaction SDK and Plugin Model

Status: **Draft / implementation in progress**

## Summary

Axrail introduces an optional headless interaction package:

```text
@axrail/interaction-sdk
```

Its purpose is to let third-party HMI/SCADA/CAD/robot/MES/engineering applications reuse one AI interaction pipeline while preserving their own UI.

The package combines a small mandatory Interaction Core with a deliberately constrained plugin model.

## 1. Motivation

Without an interaction layer, every engineering product must independently implement:

```text
AI chat request handling
selection snapshot
Adapter Context retrieval
context composition
Agent invocation
event mapping
cancel/failure handling
plugin/extension conventions
```

Independent implementations will drift and eventually bypass or misunderstand Axrail governance.

A reusable SDK should reduce duplicated glue code while keeping all durable engineering effects inside the existing governed runtime.

## 2. Design decision

Axrail adopts:

```text
Interaction Core + Interaction Plugins
```

Axrail does not adopt a global "everything is a plugin" kernel.

The following remain authoritative runtime primitives:

```text
HarnessRuntime
ToolRuntime
Policy
Validation
Approval
ChangeSet
TransactionRuntime
ProviderBoundTransactionExecutor
Adapter provider ownership
Audit checkpoints
```

## 3. Core architecture

```text
Third-party UI
      ↓
InteractionRuntime
  ├─ turn lifecycle
  ├─ selection validation
  ├─ Adapter Context
  ├─ plugin Context
  ├─ context budget
  ├─ event normalization
  └─ PluginHost
      ↓
HarnessAgent
      ↓
ToolRuntime / Transactional Mutation
      ↓
Adapter
```

## 4. InteractionPlugin

Plugins receive a narrow registration API.

They cannot obtain privileged mutation services through the SDK contract.

Supported first-version registrations:

- context contributor;
- before-turn hook;
- after-turn hook;
- interaction-event observer.

All registrations are disposable.

## 5. Setup atomicity

Plugin setup is treated transactionally at the local registration level.

If plugin setup fails after making one or more registrations, the host disposes those registrations in reverse order and does not retain the plugin.

This prevents half-mounted interaction extensions.

## 6. ContextContributor

A contributor can provide additional normalized engineering context.

It cannot choose a different provider identity for its contribution; the Interaction Runtime stamps/associates contributions with the active provider and contributor identity.

Contributor failures happen before Agent execution and therefore fail the turn.

## 7. Context budget

Default context composition has a finite character budget.

The runtime does not silently truncate over-budget engineering context.

Instead:

```text
context > budget
      ↓
interaction fails before Agent/model execution
```

The embedding application may configure a different budget.

## 8. Context instruction boundary

Adapter/plugin context can contain arbitrary engineering strings.

The generated system envelope explicitly marks these values as untrusted data/context.

The envelope must not intentionally reinterpret context payloads as system instructions.

This is not a complete prompt-injection defense, but it preserves a clear semantic boundary.

## 9. Selection provider binding

When `SelectionContext` exists:

```text
selection.providerId === send.providerId
```

Otherwise interaction fails before model execution.

This is analogous to provider-aware mutation routing, but Selection remains contextual rather than authoritative effect identity.

## 10. Agent reuse

The Interaction SDK must call Harness Agent APIs.

It must not introduce a second Tool execution or governance engine.

Any Tool calls still flow through Harness ToolRuntime and existing Policy/Approval/audit behavior.

## 11. Event model

Interaction events are UI-facing lifecycle signals.

First-version events include:

- `interaction.plugin.mounted`;
- `interaction.plugin.unmounted`;
- `interaction.turn.started`;
- `interaction.context.collected`;
- `interaction.agent.event`;
- `interaction.turn.completed`;
- `interaction.turn.cancelled`;
- `interaction.turn.failed`.

Event observer failure is observational and does not alter authoritative execution truth.

## 12. Conversation continuity

The first package version is turn-oriented.

It intentionally does not establish an independent persisted multi-turn transcript model.

Future conversation continuation must be designed around authoritative Harness Session/Event semantics.

## 13. Security

Interaction plugins are in-process trusted application extensions in the first version.

There is no sandbox.

Therefore plugin package discovery/marketplace/untrusted loading is out of scope.

The narrow Plugin API is an architecture boundary, not a security sandbox.

## 14. Third-party HMI use

```ts
const interaction = new InteractionRuntime({
  harness,
  model,
})

await interaction.mount(myHmiInteractionPlugin)

await interaction.send({
  message: "把框选的泵横向排列",
  providerId: "vendor-hmi",
  artifactIds: ["project:1"],
  selection,
})
```

The HMI still owns canvas selection and the private engineering Adapter.

## 15. Non-goals

- React/Vue UI package;
- plugin marketplace;
- arbitrary dynamic plugin loading;
- replacing Axrail governance services;
- multi-agent orchestration;
- cloud control plane;
- vector/RAG platform;
- persisted conversation implementation.

## 16. Validation

Acceptance requires:

- build/type declarations;
- plugin lifecycle rollback tests;
- provider mismatch tests;
- context budget tests;
- successful Harness Agent path;
- cancel/failure tests;
- event observer isolation;
- Node 20/22/24 compatibility;
- global line/function/branch coverage >=95%.
