# RFC 0004: Capability & Plugin Model

Status: **Exploratory / not on the supported runtime path**

This RFC records capability/plugin architecture research for Axrail. It is **not** the current supported composition model.

The implemented runtime is centered on:

```text
@axrail/harness
        ↓
HarnessRuntime
        ↓
AdapterHost
        ↓
Tool / Artifact / Validation / Policy / Context provider surfaces
```

`@axrail/core` remains private/experimental/internal. The Harness does not depend on it.

## 1. Why this RFC remains

Axrail still has legitimate future requirements that may benefit from a generic capability abstraction:

- replaceable model providers;
- multiple engineering Adapters;
- storage implementations;
- scoped context or policy providers;
- optional runtime extensions;
- deterministic provider selection;
- lifecycle and unload semantics.

However, v0.1 implementation work demonstrated that a generic plugin kernel should not be introduced merely because these concerns can be modeled generically.

The current principle is therefore:

> Prefer explicit typed runtime/Adapter surfaces first. Introduce a generic capability kernel only where repeated concrete integrations demonstrate that it materially reduces complexity.

This supersedes the earlier assumption that all runtime features must necessarily flow through a generic plugin container.

## 2. Current architecture boundary

The supported v0.1 composition model is:

```text
Application
    ↓
HarnessRuntime
    ├── Agent
    ├── ToolRuntime
    ├── TransactionRuntime
    ├── EventStore / Sessions
    ├── Approval
    └── AdapterHost
            ├── Tools
            ├── Artifacts
            ├── Validation
            ├── Policy
            └── Context
```

AdapterHost already provides lifecycle-managed, provider-scoped integration for engineering systems without requiring the public runtime to depend on `@axrail/core`.

## 3. `@axrail/core` status

For the current release line:

```text
package: @axrail/core
version: 0.0.0
private: true
status: experimental research
```

It must not be treated as:

- a required dependency of `@axrail/harness`;
- part of the supported public v0.1 package set;
- a contract that external Adapter authors must implement;
- a stable plugin API.

No compatibility guarantee is made for its current capability/plugin/scope implementation.

## 4. Retained capability concepts

The following concepts remain useful vocabulary and research directions.

### Capability

A capability is a stable category of functionality rather than a concrete provider.

Potential examples:

```text
axrail.tools
axrail.artifacts
axrail.transactions
axrail.policy
axrail.approval
axrail.validation
axrail.events
axrail.models
axrail.adapters
axrail.context
```

### Provider

A provider supplies an implementation for a capability. Multiple providers may coexist where the contract supports scoped or multi-provider resolution.

### Scope

A scope can constrain provider visibility and selection for a runtime, workspace, session, transaction, tenant, or test environment.

These concepts do not imply that Axrail must expose a single universal container API.

## 5. Where explicit typed surfaces are preferred

Today the following areas intentionally use dedicated APIs:

```text
Tools        → ToolRegistry / ToolRuntime
Artifacts    → ArtifactProviderRegistry
Validation   → ValidationPipeline
Policy       → PolicyEngine
Approval     → ApprovalService / explicit providers
Adapters     → AdapterHost / AdapterRegistry
Events       → EventStore
Transactions → TransactionRuntime
```

Typed surfaces are preferable while they provide clearer invariants, stronger semantics and simpler failure behavior than a generic lookup container.

## 6. Adapter lifecycle as the primary extension mechanism

For engineering-system integration, Adapter lifecycle is the supported extension path.

A mounted Adapter may contribute:

```text
Tool definitions
Artifact provider
Validators
Policy providers
Context providers
Approval providers (experimental selection semantics)
Transaction participant (experimental)
```

Provider identity is bound to the Adapter so same-name semantic Tools or Validators can coexist without losing provenance.

This is currently more important to Axrail than a generic plugin lifecycle.

## 7. Conditions for revisiting a generic capability kernel

A public capability/plugin kernel should be reconsidered only when concrete integrations expose repeated requirements that cannot be cleanly addressed through Harness and Adapter contracts.

Examples that could justify revisiting it:

- several non-Adapter extension classes need identical lifecycle and dependency semantics;
- nested scopes become a recurring cross-package requirement;
- users need deterministic late-bound provider replacement beyond Adapter scoping;
- hot loading/unloading must coordinate multiple provider classes uniformly;
- a stable plugin ecosystem requires a common manifest and compatibility contract.

Even then, the proposal must demonstrate that it simplifies the public API rather than creating a second runtime architecture beside HarnessRuntime.

## 8. Constraints on any future plugin model

If this RFC later advances toward a supported API, it should preserve these constraints.

### No ambient privileged bypass

A plugin mechanism must not allow a provider to bypass Tool governance, Transaction boundaries, Policy, Approval, Validation, or audit requirements.

### Scope-aware resolution

Provider selection must be explicit or deterministic and must fail closed on unsafe ambiguity.

### Lifecycle rollback

A provider from a failed setup/start sequence must not remain visible.

### Active-use safety

Hot unload, if supported, must not dispose a provider while privileged executions or Transactions still rely on it.

### Compatibility separation

Package/runtime versions, serialized protocol versions and capability contract versions may evolve independently where appropriate.

## 9. Relationship to the v0.2 roadmap

RFC-0004 is now a convergence task rather than an implementation mandate.

Near-term priority is:

```text
1. Harness / Adapter architecture remains primary
2. Transactional Mutation path is defined
3. Real HMI Adapter exercises the boundaries
4. Second engineering integration validates generality
5. Only then decide whether a public generic plugin kernel is necessary
```

The expected outcome may be one of two valid results:

```text
A. real integrations prove a generic kernel is useful
   → redesign RFC-0004 from observed requirements

B. Harness + Adapter contracts remain sufficient
   → keep generic capability infrastructure internal or remove it
```

Both outcomes are acceptable. The architecture should be driven by execution requirements rather than preserving an early abstraction for its own sake.

## 10. Open questions

The remaining questions should be answered through real integration work:

1. Which provider classes genuinely need nested scopes outside Adapter boundaries?
2. Is a generic dependency graph required, or are typed Harness dependencies clearer?
3. Which lifecycle behaviors repeat across model/storage/Adapter extensions?
4. Would a plugin manifest improve compatibility for third-party integrations?
5. Can future plugin loading preserve governed execution invariants without introducing an alternate side-effect path?

Until those questions have concrete answers, RFC-0004 remains exploratory and `@axrail/core` remains private.