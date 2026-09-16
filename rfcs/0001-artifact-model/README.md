# RFC 0001: Artifact Model

Status: Draft

## Summary

Defines the portable engineering asset model used across Axrail agents, policies, validators, transactions, and adapters.

An Artifact is the stable handle through which Axrail refers to an engineering asset without requiring the kernel to understand vendor-specific internals.

## Goals

- Provide a vendor-neutral identity for engineering assets.
- Support versioning and optimistic concurrency.
- Allow adapters to expose rich metadata without polluting the core schema.
- Keep artifacts serializable and transportable across process boundaries.
- Make artifacts suitable for policy, validation, audit, and transaction scopes.

## Non-goals

- Define the internal schema of HMI, PLC, CAD, robot, MES, or other projects.
- Replace the source format owned by the external engineering application.
- Require an artifact to contain its complete payload inline.

## Conceptual model

```text
Artifact
├── id
├── type
├── version
├── provider
├── metadata
├── capabilities
└── locator
```

## Proposed TypeScript contract

```ts
export interface ArtifactRef {
  id: string
  type: string
  version?: string
  provider?: string
}

export interface Artifact extends ArtifactRef {
  metadata?: Record<string, unknown>
  capabilities?: string[]
  locator?: ArtifactLocator
}

export interface ArtifactLocator {
  kind: string
  value: string
}
```

## Identity

`id` MUST be stable within the provider's namespace. URI-like identifiers are recommended because they compose well across adapters.

Examples:

```text
hmi://factory-a/main-project
plc://line-01/controller-1
robot://cell-03/program/weld-main
mes://plant-a/workflow/order-release
```

Axrail MUST treat identifiers as opaque strings. Parsing provider-specific semantics from the identifier belongs in adapters.

## Type

`type` describes the semantic class of artifact.

Recommended dotted naming:

```text
industrial.hmi.project
industrial.plc.project
industrial.robot.program
industrial.mes.workflow
engineering.cad.model
```

Types are extensible. Axrail core MUST NOT maintain a closed list.

## Version

`version` represents the external or Axrail-observed revision used for concurrency control.

Before commit, a transaction MAY compare the expected version with the current provider version. If they differ, the transaction SHOULD fail with a conflict instead of silently overwriting external changes.

## Provider

`provider` identifies the adapter or external integration responsible for resolving the artifact.

Examples:

```text
company-hmi
wincc-adapter
opcua-adapter
robot-vendor-x
```

## Metadata

`metadata` is intentionally extensible and MUST remain non-authoritative for execution unless a capability explicitly defines its semantics.

Examples include:

- display name
- project path
- plant/line/cell identifiers
- owner
- timestamps
- target runtime
- domain tags

## Capabilities

Artifacts MAY advertise capabilities relevant to agents and runtime components.

Example:

```yaml
capabilities:
  - inspect
  - diff
  - validate
  - preview
  - commit
  - rollback
```

Capabilities describe what can be requested, not whether an operation is currently authorized. Authorization remains a policy concern.

## Artifact providers

Adapters MAY implement an ArtifactProvider contract.

```ts
export interface ArtifactProvider {
  get(ref: ArtifactRef): Promise<Artifact>
  exists(ref: ArtifactRef): Promise<boolean>
  currentVersion(ref: ArtifactRef): Promise<string | undefined>
}
```

Future revisions may add listing, discovery, snapshot, or materialization methods.

## Snapshots

Axrail SHOULD distinguish an Artifact identity from an Artifact Snapshot.

```ts
export interface ArtifactSnapshot {
  artifact: ArtifactRef
  version: string
  capturedAt: string
  content?: unknown
  contentRef?: string
  hash?: string
}
```

Snapshots are useful for preview, diff, rollback, deterministic validation, and audit.

Large engineering payloads SHOULD use `contentRef` instead of being embedded directly in agent context.

## Concurrency

Transactions SHOULD use optimistic concurrency by default.

```text
read artifact @ version 18
        ↓
prepare ChangeSet
        ↓
validate
        ↓
commit only if current version == 18
```

If the current version is 19, commit SHOULD return a version conflict and require rebase/revalidation.

## Security

Artifact metadata may reveal sensitive industrial topology. Providers SHOULD support redaction and least-privilege context generation.

An ArtifactRef itself MUST NOT imply write permission.

## Events

Suggested artifact events:

```text
artifact.resolved
artifact.opened
artifact.snapshot.created
artifact.version.conflict
artifact.updated
```

## Open questions

- Whether Axrail should define a standard content-addressed snapshot format.
- Whether parent/child artifact relations belong in this RFC or a future graph RFC.
- Whether capability negotiation should be embedded in Artifact or resolved through a separate registry.

## Compatibility

Additive metadata and capabilities are backward-compatible. Removing required identity fields or changing their semantics requires a major protocol revision.
