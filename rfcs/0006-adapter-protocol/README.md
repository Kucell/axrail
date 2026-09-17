# RFC 0006: Adapter Protocol

Status: **Implemented foundation / transaction semantics under active convergence**

This RFC defines how engineering systems integrate with Axrail without coupling the generic runtime to vendor-specific schemas or product implementations.

The supported integration path is `@axrail/adapter-sdk` mounted through `AdapterHost` and composed by `HarnessRuntime`.

## 1. Goals

An Adapter should let an engineering system expose governed capabilities such as Tools, Artifacts, Validation, Policy, Context, Approval integration, and Transaction execution/participation while preserving provider identity, explicit routing, lifecycle isolation, governance before privileged effect, capability degradation reporting, and auditability.

An Adapter must not become a privileged bypass around Tool or Transaction governance.

## 2. Current public contract

The current SDK shape is conceptually:

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

  initialize?(context: AdapterLifecycleContext): Promise<void> | void
  start?(context: AdapterLifecycleContext): Promise<void> | void
  stop?(context: AdapterLifecycleContext): Promise<void> | void
}
```

`AdapterHost` binds Tool/Validator/Policy provider identity to the Adapter and drains registered provider surfaces before external shutdown begins.

## 3. Capability manifest

Support levels are:

```text
exact
compatible
degraded
unsupported
```

They allow the Harness/application to reason about whether a target actually supports preview, rollback, validation, deployment, context retrieval, or transactional guarantees.

## 4. Provider identity and routing

Semantic capability identity and provider identity are separate concerns.

Multiple Adapters may expose the same semantic Tool while Axrail still needs deterministic provider selection.

```text
semantic Tool name ≠ provider identity
```

Provider ambiguity for privileged execution should fail closed rather than select an arbitrary Adapter.

The same provider-scoping principle applies to Validators, Policy providers, Artifact access, and explicit Context retrieval.

## 5. Lifecycle

The Adapter lifecycle is:

```text
registered
  ↓
initializing
  ↓
ready
  ↓
active
  ↓
stopping
  ↓
stopped
```

A failed mount must clean up already-registered local surfaces. During unmount, local routing surfaces are removed before external `stop()` work begins.

## 6. Context providers

Context retrieval remains explicit and scoped:

```text
application / Harness
      ↓
explicit adapterIds
      ↓
Adapter Context Provider(s)
      ↓
Context fragments
```

Sensitive fragments remain excluded unless explicitly requested. Returned Context is not automatically inserted into model prompts.

The v0.2 direction adds a separate Context Assembly layer rather than weakening these rules.

## 7. Policy and Validation

Adapter Policy and Validation remain distinct:

```text
Policy     → is this operation allowed?
Validation → is the proposed/executed engineering change technically valid?
```

Adapter-scoped providers must not accidentally evaluate operations belonging to another Adapter.

## 8. Approval providers

Adapter-provided Approval providers are experimental in v0.1.

They may be mounted for discovery, but Harness governance expects ApprovalService selection to be configured explicitly by the application.

Future selection rules must define authority, scope, quorum composition and evidence binding.

## 9. Transaction execution: current state

`AdapterTransactionParticipant` currently exposes an experimental `prepare` / `commit` / `rollback` shape.

The existing Harness does not yet orchestrate general multi-Adapter transaction participants automatically. These semantics should not be frozen before a real engineering integration exercises them.

## 10. Transactional Mutation direction

For durable engineering changes, the desired path is:

```text
Agent / Application Intent
        ↓
Tool / Change Proposal
        ↓
ChangeSet
        ↓
Harness Transaction API
        ↓
Policy
        ↓
Validation
        ↓
Approval
        ↓
Adapter Executor
        ↓
Apply
        ↓
Verify
        ↓
Commit / Rollback / Explicit Uncertainty
```

The Adapter protocol therefore needs to converge on executor semantics, not only participant lifecycle hooks.

Key questions for the next revision:

1. How does Harness select the executor for a ChangeSet?
2. Is selection based on Artifact provider, explicit Adapter IDs, ChangeSet metadata, or an application resolver?
3. How are mixed-provider ChangeSets handled?
4. How does an Adapter declare atomic, compensating or best-effort behavior?
5. What constitutes preview versus prepare?
6. Which verification occurs before commit and which occurs after external effect?
7. When rollback is impossible, how is effect uncertainty represented?
8. How are optimistic concurrency versions obtained and checked across Adapter boundaries?

## 11. Single-Adapter transactions first

The next protocol iteration should prioritize:

```text
one ChangeSet
  ↓
one primary Adapter / engineering target
  ↓
one TransactionExecutor
```

This is enough to validate the complete governed execution path in a real HMI integration.

Distributed multi-Adapter transaction orchestration should wait until concrete use demonstrates the requirement.

## 12. Mutation semantics by risk

The protocol should support this architecture direction:

```text
L0 read/query
  → direct governed Tool

L1 local/draft mutation
  → Tool or Transaction depending on contract/policy

L2 engineering modification
  → ChangeSet + Transaction by default

L3 deploy/overwrite
  → Transaction required by default

L4 physical effect
  → explicit command semantics; do not pretend all actions are rollback-capable

L5 safety critical
  → explicit Transaction + Approval boundary and deterministic external safety controls
```

Adapters may impose stricter requirements.

## 13. Preview capability

Preview is a first-class engineering concern but not every target supports it equally.

Adapters should report preview support through capability metadata as exact, compatible, degraded or unsupported.

Preview output should remain tied to the same ChangeSet/evidence identity that is later validated and approved.

## 14. Failure and uncertainty

An Adapter must not turn unknown external state into a false success/failure claim.

Examples include timeout after sending deployment, connection loss during commit, malformed confirmation after application, or failed rollback after partial application.

The runtime should preserve explicit states such as:

```text
partially_applied
execution_uncertain
verification_failed
rollback_failed
```

instead of encouraging unsafe automatic retry.

## 15. HMI reference validation

HMI/SCADA is the first reference domain for exercising this protocol.

A real integration should test at least:

```text
project inspect
screen inspect
screen/component mutation
ChangeSet generation
precondition/version check
validation
preview
approval
apply
verify
commit
rollback/recovery path
```

The proprietary HMI implementation remains outside the open-source repository. Findings that are genuinely generic should flow back into this RFC and `@axrail/adapter-sdk`.

## 16. Compatibility targets

Adapters may represent AI-native HMI systems, legacy HMI/SCADA, PLC engineering systems, OPC UA integrations, robot platforms, MES, digital twins, or CAD/CAE tools.

Capability degradation is preferable to pretending unsupported transactional guarantees exist.

## 17. Non-goals for the immediate revision

Deferred unless real integrations require them:

```text
generic plugin marketplace
arbitrary dynamic package loading
multi-tenant cloud control plane
distributed multi-Adapter transactions
universal Adapter discovery service
```

## 18. Near-term acceptance criteria

Before advanced Adapter transaction surfaces are considered stable, Axrail should demonstrate:

1. a Harness-level high-level ChangeSet execution path;
2. deterministic executor/Adapter selection for a single-target ChangeSet;
3. provider-scoped Policy and Validation;
4. Approval evidence bound to immutable ChangeSet/execution evidence;
5. preview semantics or explicit unsupported/degraded reporting;
6. apply/verify/commit/rollback behavior exercised by tests;
7. explicit effect uncertainty where outcome cannot be proven;
8. one real HMI Adapter vertical slice;
9. a second substantially different integration before claiming broad protocol stability.

Until then, the current Adapter SDK foundation remains supported while advanced transaction composition surfaces remain experimental.