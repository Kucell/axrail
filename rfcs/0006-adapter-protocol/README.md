# RFC 0006: Adapter Protocol

Status: Draft

Defines the contract between Axrail and external engineering systems.

## 1. Motivation

Axrail must connect to HMI/SCADA, PLC engineering software, robotics platforms, MES, digital twins, CAD/CAE, and other engineering systems without hard-coding vendor concepts into the kernel.

Adapters provide that boundary.

## 2. Design goals

An Axrail adapter should:

- expose capabilities without leaking vendor internals into the kernel;
- provide tools, artifacts, context, validators, and policies;
- report feature support explicitly;
- support import/export or native operations where appropriate;
- expose deterministic failure modes;
- preserve transaction, policy, validation, approval, and audit guarantees.

## 3. Adapter contract

```ts
export interface AxrailAdapter {
  readonly id: string
  readonly version: string

  capabilities(): Promise<CapabilityManifest>

  tools?(): ToolProvider[]
  artifacts?(): ArtifactProvider
  context?(): ContextProvider[]
  validators?(): Validator[]
  policies?(): PolicyProvider[]
  approvals?(): ApprovalProvider[]
  transactions?(): TransactionParticipant
}
```

All optional surfaces are registered as Axrail capabilities.

## 4. Capability manifest

Adapters MUST declare supported features.

```ts
export interface CapabilityManifest {
  adapterId: string
  adapterVersion: string
  target?: {
    vendor?: string
    product?: string
    version?: string
  }
  capabilities: Record<string, CapabilitySupport>
}

export type CapabilitySupport =
  | { level: "exact" }
  | { level: "compatible"; notes?: string }
  | { level: "degraded"; notes: string }
  | { level: "unsupported"; reason?: string }
```

The four support levels are:

- `exact` — Axrail semantics map directly to the target system;
- `compatible` — semantics are preserved with implementation differences;
- `degraded` — only a subset is available;
- `unsupported` — the target cannot provide the capability.

Agents SHOULD inspect this manifest before constructing a ChangeSet.

## 5. Artifact provider

Adapters MAY expose engineering assets as Axrail Artifacts.

```ts
export interface ArtifactProvider {
  get(ref: ArtifactRef): Promise<Artifact>
  snapshot(ref: ArtifactRef): Promise<ArtifactSnapshot>
  list?(query?: ArtifactQuery): Promise<Artifact[]>
  watch?(ref: ArtifactRef): AsyncIterable<ArtifactEvent>
}
```

Artifact identity SHOULD remain stable even when the underlying vendor object uses a different native identifier.

## 6. Tool provider

Adapters expose target-system operations through the Axrail Tool Runtime.

Examples:

```text
hmi.screen.create
hmi.component.add
plc.symbol.read
plc.project.compile
robot.program.validate
mes.workflow.update
```

Adapters MUST NOT allow registered tools to bypass Axrail policy, approval, transaction, validation, or audit stages.

## 7. Context provider

Adapters MAY contribute domain context.

```ts
export interface ContextProvider {
  id: string
  build(input: ContextRequest): Promise<ContextFragment>
}
```

Examples include:

- current HMI project structure;
- target PLC platform and firmware;
- current robot program;
- deployment environment;
- live versus design-time mode;
- available assets and tags;
- platform capability limits.

## 8. Validators

Adapters SHOULD register validators for vendor-specific constraints.

Examples:

- unsupported HMI component types;
- invalid PLC address formats;
- incompatible runtime versions;
- robot program syntax errors;
- target environment deployment restrictions.

Adapter validation complements, but does not replace, generic Axrail validation.

## 9. Policies

Adapters MAY provide additional target-specific policy rules.

Examples:

- live PLC writes require operator approval;
- production deployment requires an engineering role;
- safety-related parameters cannot be changed through AI tools;
- certain operations are only allowed in simulation mode.

The final policy decision is the composition of global Axrail policy and adapter policy.

## 10. Transaction participation

Adapters may participate in one of three transaction modes:

### Native atomic

The target system supports true transactional mutation.

### Compensating

The adapter records enough state to undo successful operations when a later step fails.

### Best effort

The target cannot guarantee rollback. This limitation MUST be visible in the capability manifest and transaction plan.

```ts
export interface TransactionParticipant {
  mode: "atomic" | "compensating" | "best-effort"
  prepare?(tx: AdapterTransactionContext): Promise<void>
  commit?(tx: AdapterTransactionContext): Promise<void>
  rollback?(tx: AdapterTransactionContext): Promise<void>
}
```

## 11. Adapter lifecycle

```text
registered
  ↓
initialized
  ↓
ready
  ↓
active
  ↓
stopping
  ↓
stopped
```

Initialization failures MUST be explicit and MUST NOT leave partial capabilities registered.

## 12. Namespacing

Adapter capability and tool identifiers SHOULD be namespaced.

Recommended tool naming:

```text
<domain>.<resource>.<action>
```

Examples:

```text
hmi.screen.create
plc.project.compile
robot.program.validate
```

Vendor-specific identifiers MAY include an additional adapter namespace when collisions are possible.

## 13. External protocol bridging

An adapter may wrap REST, SDK, OPC UA, MCP, proprietary RPC, file formats, or local processes.

The underlying protocol is an implementation detail. Axrail-facing contracts remain stable.

## 14. HMI reference adapter

An AI-native HMI integration could expose:

```text
hmi.project.inspect
hmi.screen.create
hmi.component.add
hmi.component.update
hmi.binding.create
hmi.alarm.create
hmi.project.validate
hmi.preview
hmi.deploy
```

The Axrail kernel does not know what a screen, component, alarm, or binding is; those concepts live in the adapter/domain layer.

## 15. Security requirements

Adapters MUST:

- avoid embedding secrets in events or artifacts;
- propagate execution identity where possible;
- expose environment boundaries such as design/test/production;
- respect policy decisions from Axrail;
- fail closed for privileged operations when the target state is ambiguous;
- expose whether a tool can cause live physical effects.

## 16. Compatibility

Adapters SHOULD declare:

- Axrail protocol version range;
- adapter version;
- target software version range;
- optional feature flags.

A future stable adapter manifest MAY use semantic version ranges.

## 17. v0.1 minimum

The initial Adapter SDK needs only:

1. adapter identity;
2. capability manifest;
3. tool registration;
4. artifact provider;
5. validators;
6. policy hooks;
7. transaction participation metadata;
8. lifecycle hooks.

Import/export helpers and marketplace metadata can come later.
