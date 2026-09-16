# RFC 0004: Capability & Plugin Model

Status: Draft

Defines the capability contracts, plugin lifecycle, dependency model, scopes, and provider resolution rules used by the Axrail kernel.

## 1. Motivation

Axrail must remain independent of specific HMI, PLC, robot, MES, model, storage, policy, or validation implementations. The kernel therefore needs a small abstraction that lets providers contribute functionality without coupling consumers to concrete packages.

The design goal is:

> Consumers depend on capabilities. Plugins provide capabilities.

This preserves replaceability and allows multiple providers to coexist.

## 2. Goals

This RFC defines:

- capability identity
- capability contracts
- plugin manifests
- plugin lifecycle
- dependency declaration
- provider registration
- provider resolution
- scopes
- isolation
- conflicts
- version compatibility
- failure behavior

This RFC does not define domain-specific HMI, PLC, or robotics models.

## 3. Capability

A capability is a stable contract representing a category of runtime functionality.

Examples:

```text
axrail.tools
axrail.artifacts
axrail.transactions
axrail.policy
axrail.approval
axrail.validation
axrail.events
axrail.sessions
axrail.models
axrail.adapters
axrail.context
```

A capability is not a concrete service implementation.

```ts
export interface Capability<T> {
  id: string
  version: string
  contract?: T
}
```

A capability identifier SHOULD use a reverse-domain-like namespace or Axrail-reserved namespace.

Examples:

```text
axrail.tools
axrail.validation
vendor.hmi.project
vendor.robot.motion
```

## 4. Provider

A provider supplies an implementation for a capability.

```ts
export interface CapabilityProvider<T = unknown> {
  id: string
  capability: string
  version: string
  priority?: number
  value: T
}
```

Multiple providers MAY implement the same capability when the capability supports multi-provider resolution.

Examples:

- several validator providers
- several tool providers
- multiple context providers

Some capabilities MAY be single-provider within a scope.

Examples:

- one primary transaction coordinator
- one primary event store

The capability definition SHOULD declare its resolution mode.

```ts
type CapabilityResolutionMode =
  | "single"
  | "multiple"
  | "ordered"
```

## 5. Plugin

A plugin is a lifecycle-managed unit that may register one or more capability providers.

```ts
export interface AxrailPlugin {
  manifest: PluginManifest

  setup(ctx: PluginSetupContext): void | Promise<void>
  start?(ctx: PluginRuntimeContext): void | Promise<void>
  stop?(ctx: PluginRuntimeContext): void | Promise<void>
  dispose?(ctx: PluginRuntimeContext): void | Promise<void>
}
```

A plugin SHOULD not reach into another plugin's private state. Cross-plugin collaboration SHOULD occur through capability contracts or events.

## 6. Plugin Manifest

```ts
export interface PluginManifest {
  id: string
  version: string
  axrail: string

  provides?: CapabilityDeclaration[]
  requires?: CapabilityRequirement[]
  optional?: CapabilityRequirement[]

  metadata?: Record<string, unknown>
}
```

Example:

```yaml
id: vendor.hmi.adapter
version: 0.1.0
axrail: ">=0.1 <0.2"
provides:
  - capability: axrail.adapters
    version: 1
  - capability: axrail.tools
    version: 1
requires:
  - capability: axrail.artifacts
    version: 1
optional:
  - capability: axrail.approval
    version: 1
```

## 7. Lifecycle

The standard lifecycle is:

```text
registered
   ↓
resolved
   ↓
setup
   ↓
started
   ↓
running
   ↓
stopping
   ↓
stopped
   ↓
disposed
```

### registered

Manifest is accepted and basic validation succeeds.

### resolved

Required capabilities and compatible provider versions are resolved.

### setup

Plugin registers providers, hooks, schemas, and metadata. External side effects SHOULD be minimized.

### started

Plugin may open connections, initialize workers, subscribe to external systems, or allocate runtime resources.

### stopped

Plugin ceases active runtime behavior while preserving enough state for orderly shutdown.

### disposed

Plugin releases final resources and MUST no longer serve capability requests.

## 8. Dependency Resolution

Dependencies are capability-based rather than package-name-based.

A plugin may require:

```yaml
requires:
  - capability: axrail.transactions
    version: 1
```

The kernel MUST fail plugin activation if a required capability cannot be resolved.

Optional capabilities MUST NOT prevent activation.

The kernel SHOULD report dependency errors with:

- requesting plugin
- required capability
- required version range
- available providers
- rejection reason

## 9. Provider Resolution

For `single` resolution mode:

1. filter by compatible version
2. filter by scope visibility
3. apply explicit user/runtime selection when configured
4. otherwise apply highest priority
5. fail on unresolved equal-priority ambiguity unless the capability defines deterministic tie-breaking

For `multiple` mode:

all compatible providers are returned.

For `ordered` mode:

providers are returned in deterministic priority order.

Provider ordering MUST be stable across identical runtime configurations.

## 10. Scopes

Capabilities exist within scopes so that projects, transactions, sessions, or tenants can override or isolate providers.

Suggested hierarchy:

```text
Runtime Scope
   ↓
Workspace Scope
   ↓
Session Scope
   ↓
Transaction Scope
```

A child scope inherits visible providers from its parent unless overridden by capability rules.

```ts
export interface Scope {
  id: string
  parent?: Scope

  provide<T>(provider: CapabilityProvider<T>): Disposable
  resolve<T>(capability: string): T
  resolveAll<T>(capability: string): T[]
}
```

Typical use cases:

- workspace-specific HMI adapter
- transaction-specific sandbox provider
- session-specific model provider
- test-specific fake capability

## 11. Capability Context

Consumers SHOULD receive a capability context rather than a global mutable container.

```ts
export interface AxrailContext {
  scope: Scope
  events: EventEmitter

  get<T>(capability: string): T
  getAll<T>(capability: string): T[]
}
```

Domain-specific convenience accessors MAY wrap generic resolution:

```ts
ctx.tools
ctx.transactions
ctx.validation
```

These accessors MUST still resolve through capability contracts.

## 12. Plugin Isolation

Plugins MUST NOT rely on undocumented kernel internals.

The supported integration surfaces are:

- capability registration
- capability resolution
- lifecycle context
- structured events
- documented extension hooks

The kernel SHOULD expose no ambient global singleton that allows plugins to bypass scopes.

## 13. Failure Model

Plugin failures are categorized as:

```text
manifest_error
dependency_error
setup_error
start_error
runtime_error
stop_error
dispose_error
```

A provider MUST NOT remain visible after failed setup.

A plugin that fails during start SHOULD have setup registrations rolled back where possible.

Critical kernel providers MAY mark startup as failed if they cannot initialize.

Non-critical plugins MAY be disabled while the runtime continues.

## 14. Hot Loading and Unloading

Hot loading is desirable but not required for the first implementation.

If supported, unload MUST respect active leases.

A provider with active transaction or tool execution leases MUST NOT be disposed until those leases finish or are explicitly aborted.

```text
unload requested
      ↓
stop accepting new leases
      ↓
wait / abort active leases
      ↓
stop
      ↓
dispose
      ↓
unregister providers
```

## 15. Capability Versioning

Capabilities SHOULD have their own contract versions separate from package versions.

Example:

```text
Package @axrail/tools 0.7.3
Capability axrail.tools v1
```

This allows internal package releases without forcing protocol changes.

Breaking contract changes MUST increment the capability major version.

## 16. Plugin Trust

Loading a plugin means allowing code to execute inside the Axrail runtime process unless sandboxed by a host environment.

Plugin installation and capability trust are separate from tool execution policy.

Axrail SHOULD eventually support metadata such as:

```yaml
trust:
  publisher: verified
  source: registry
  signature: optional
```

This is deferred from v0.1 enforcement.

## 17. Example

```ts
const plugin: AxrailPlugin = {
  manifest: {
    id: "example.hmi",
    version: "0.1.0",
    axrail: ">=0.1 <0.2",
    provides: [
      { capability: "axrail.tools", version: "1" },
      { capability: "axrail.adapters", version: "1" }
    ]
  },

  setup(ctx) {
    ctx.provide({
      id: "example.hmi.tools",
      capability: "axrail.tools",
      version: "1",
      value: createHmiToolProvider()
    })
  }
}
```

## 18. Kernel Constraints

The Axrail kernel MUST remain unaware of concrete engineering concepts such as HMI screens, PLC tags, alarms, recipes, robot axes, or CAD features.

Those concepts enter the runtime through plugin-provided capabilities.

## 19. v0.1 Minimum Implementation

The first implementation SHOULD include:

- plugin manifest validation
- explicit plugin registration
- setup/start/stop/dispose lifecycle
- capability registry
- single/multiple/ordered resolution
- hierarchical scopes
- dependency validation
- deterministic provider ordering
- structured lifecycle events

Deferred:

- signed plugins
- remote plugin distribution
- dynamic process isolation
- hot upgrades with state migration

## 20. Open Questions

1. Should capability identifiers include a formal URI scheme?
2. Should version negotiation use SemVer ranges or integer protocol versions?
3. Which capabilities are reserved under the `axrail.*` namespace?
4. Should transaction scopes prevent provider replacement after execution begins?
5. Should plugin manifests become a standalone JSON Schema distributed by Axrail?
