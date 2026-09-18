# AI-native HMI / Configuration Product Integration Guide

[English](README.md) | [简体中文](README.zh-CN.md)

Status: **integration-readiness handoff for post-RC Axrail `main`**

This guide is for a product team integrating an AI-native HMI, SCADA, configuration, visualization, or engineering product with Axrail.

The first goal is not full deployment automation. The first goal is to prove a safe, truthful, provider-bound vertical slice:

```text
inspect project
  ↓
inspect screen / engineering context
  ↓
construct one durable ChangeSet
  ↓
preview or explicitly report unsupported/degraded preview
  ↓
Policy + Validation + Approval
  ↓
provider-bound apply
  ↓
verify
  ↓
commit
  ↓
one truthful failure / recovery path
```

## 1. Version baseline

The published npm packages are currently `0.1.0-rc.1`, sourced from commit:

```text
e4758656c20f6cb90b05eb3429c79010667a2f7d
```

That published RC does **not** contain the post-RC high-level `HarnessRuntime.executeChangeSet()` API described in this guide.

For the current integration handoff, use Axrail `main` at commit `05d73d4ff336ea7375388fdbd719d21f246e658f` or later, or use a later npm release that explicitly includes the provider-bound Transactional Mutation API.

Do not assume the RC1 npm package has the same high-level API as current `main`.

## 2. Architecture boundary

Axrail stays vendor-neutral. Your product-specific Adapter owns product integration; Axrail owns governed execution semantics.

```text
Your AI Chat / Agent UI
          ↓
      Axrail Agent
          ↓
     HarnessRuntime
          ↓
  Tool / Change Proposal
          ↓
       ChangeSet
          ↓
     Transaction
   ├─ Policy
   ├─ Validation
   ├─ Approval
   └─ Audit
          ↓
ProviderBoundTransactionExecutor
          │ providerId
          ↓
   Your HMI Adapter
          ↓
 Your Product SDK / API
```

The generic Harness must not import proprietary HMI schemas or vendor SDKs.

### Public Axrail may contain

- generic HMI capability names;
- generic Artifact / ChangeSet / Tool / Context contracts;
- vendor-neutral examples;
- generic validation, policy, approval, transaction, audit and recovery semantics;
- generalized integration feedback after review.

### Keep in your product repository

- proprietary project/screen/component schemas;
- internal SDK/API clients;
- credentials and authentication implementation;
- customer/project data;
- proprietary renderer/runtime code;
- vendor-specific deployment, storage and migration mechanics.

## 3. Packages used by an HMI integration

Typical integration code uses:

```text
@axrail/harness
@axrail/interaction-sdk   # post-RC optional AI interaction/context/plugin layer
@axrail/adapter-sdk
@axrail/hmi-adapter-kit
@axrail/artifacts
@axrail/changesets
@axrail/transactions
@axrail/policy
@axrail/validation
@axrail/approval
```

`@axrail/hmi-adapter-kit` is optional domain support above the generic Adapter SDK. HMI concepts do not enter `@axrail/harness` or `@axrail/core`.

## 4. Minimum Adapter contract

Implement an `AxrailAdapter` with a stable provider identity.

```ts
import type { AxrailAdapter } from "@axrail/adapter-sdk";
import {
  HMI_CAPABILITIES,
  createHmiCapabilityManifest,
  exactHmiCapabilities,
} from "@axrail/hmi-adapter-kit";

export const adapter: AxrailAdapter = {
  id: "your-hmi",
  version: "0.1.0",

  async capabilities() {
    return createHmiCapabilityManifest({
      adapterId: "your-hmi",
      adapterVersion: "0.1.0",
      protocolVersion: "0.1",
      target: {
        vendor: "Your Company",
        product: "Your HMI",
        version: "product-version",
      },
      support: exactHmiCapabilities(
        HMI_CAPABILITIES.PROJECT_ARTIFACT,
        HMI_CAPABILITIES.PROJECT_INSPECT,
      ),
    });
  },

  tools() {
    return [];
  },
};
```

Adapter lifecycle is mounted through `HarnessRuntime` / `AdapterHost`:

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

If mount fails, Axrail cleans up already-registered local provider surfaces. During unmount, local routing surfaces are drained before external shutdown begins.

## 5. Capability manifest: report truth, not intent

The HMI kit defines these standard capability names:

```text
hmi.project.artifact
hmi.project.inspect
hmi.selection.context
hmi.screen.create
hmi.screen.update
hmi.component.add
hmi.component.update
hmi.binding.create
hmi.project.validate
hmi.preview
hmi.deploy
```

Each capability reports one of:

```text
exact
compatible
degraded
unsupported
```

Use them literally:

- `exact` — product behavior matches the contract directly;
- `compatible` — behavior is equivalent but needs translation;
- `degraded` — usable with an explicit limitation;
- `unsupported` — do not emulate authority that the product does not provide.

Example:

```ts
support: {
  [HMI_CAPABILITIES.PROJECT_INSPECT]: { level: "exact" },
  [HMI_CAPABILITIES.PREVIEW]: {
    level: "degraded",
    notes: "Preview can render a single screen but not runtime scripts",
  },
  [HMI_CAPABILITIES.DEPLOY]: {
    level: "unsupported",
    reason: "Deployment is out of scope for the first integration",
  },
}
```

Do not report `exact` because the integration team plans to implement something later.

## 6. Artifact identity and optimistic concurrency

A durable engineering target should be represented as an Axrail Artifact.

The HMI kit currently provides a project Artifact helper:

```ts
import { hmiProjectRef } from "@axrail/hmi-adapter-kit";

const projectRef = hmiProjectRef("project:123", {
  provider: "your-hmi",
  version: "42",
});
```

Your Adapter should expose an `ArtifactProvider` that can return at least:

- stable Artifact identity;
- current version / revision / ETag-equivalent;
- existence;
- enough normalized metadata for governance and validation.

The `provider` value for durable HMI Artifacts should match the provider-bound executor used to mutate them.

For the first integration, use the product's real revision mechanism if available. Do not fake a version counter if the product has a stronger native concurrency token.

Version conflict must block commit rather than silently overwrite concurrent engineering changes.

## 7. Explicit engineering Context

Adapter Context is explicit and provider-scoped. Axrail does not automatically inject Adapter Context into the model.

Implement Context providers for useful engineering information such as:

```text
project summary
project tree
selected/current screen
screen component summary
available component/widget types
tag/binding summary
runtime/deployment target metadata
```

Example shape:

```ts
context() {
  return [{
    id: "project-context",
    async build(request) {
      return {
        providerId: "your-hmi",
        kind: "hmi.project.context",
        content: await buildNormalizedProjectContext(request),
        sensitive: false,
      };
    },
  }];
}
```

Retrieval is explicit:

```ts
const fragments = await harness.adapters.buildContext(
  {
    purpose: "design-screen",
    artifactIds: ["project:123"],
  },
  {
    adapterIds: ["your-hmi"],
    includeSensitive: false,
  },
);
```

Rules:

1. Sensitive fragments are excluded by default.
2. Do not put credentials, access tokens or customer secrets into model Context.
3. Prefer summarized/normalized engineering Context over dumping the full proprietary project schema.
4. Preserve stable product identifiers so proposed changes can target real engineering objects.

## 8. Read Tools vs durable mutation

Use governed Tools for semantic Agent actions.

The HMI kit provides Tool contracts for:

```text
project inspect      L0 read
screen create        L2 engineering write
screen update        L2 engineering write
component add        L2 engineering write
component update     L2 engineering write
binding create       L2 engineering write
project validate     L0 read
preview              L1 local write
deploy               L3 deploy
```

For the first integration:

- read/inspect Tools may directly call product read APIs;
- durable L2/L3 engineering mutation should converge on `ChangeSet + Transaction`;
- do not make a privileged Tool a hidden direct-write bypass around Transaction governance.

## 9. ChangeSet construction

A ChangeSet is the reviewable engineering mutation proposal.

Example:

```ts
import type { ChangeSet } from "@axrail/changesets";
import { hmiProjectRef } from "@axrail/hmi-adapter-kit";

const changeSet: ChangeSet = {
  id: "cs:add-temperature-card",
  protocolVersion: "0.1",
  artifacts: [
    hmiProjectRef("project:123", {
      provider: "your-hmi",
      version: currentProjectVersion,
    }),
  ],
  reason: "Add temperature visualization to Overview",
  actor: {
    id: currentUserId,
    type: "human",
  },
  operations: [
    {
      id: "add-component",
      op: "create",
      target: "screen:overview/component",
      value: {
        semanticType: "temperature-display",
        binding: { source: "tag:temperature" },
      },
      risk: {
        level: "L2",
        reasons: ["Modifies an engineering artifact"],
      },
    },
  ],
};
```

The ChangeSet should describe engineering intent without exposing proprietary internal object graphs unless necessary.

Prefer semantic operations and translate them into native product mutations inside the private Adapter/executor.

## 10. Provider-bound TransactionExecutor

For the high-level post-RC mutation path, the executor's `providerId` is authoritative.

```ts
import type {
  ProviderBoundTransactionExecutor,
} from "@axrail/harness";

const executor: ProviderBoundTransactionExecutor = {
  id: "your-hmi.project-executor",
  providerId: "your-hmi",
  mode: "atomic",

  async prepare(transaction) {
    // Optional: build a native staged change / transaction / edit session.
  },

  async apply(transaction) {
    // Translate immutable ChangeSet operations into your product API.
    // Do not commit final durable state here if the product supports staging.
    return { externalRef: "native-change-id" };
  },

  async verify(transaction, result) {
    // Check postconditions against the product/native staging state.
    return true;
  },

  async commit(transaction, result) {
    // Make staged engineering state durable when supported.
  },

  async rollback(transaction, result) {
    // Report real rollback/compensation truth.
    return { complete: true };
  },
};
```

Then execute through Harness:

```ts
const result = await harness.executeChangeSet(changeSet, {
  executor,
  environment: "design",
  actor: changeSet.actor,
  sessionId,
  correlationId,
  requiredApprovers: [{ role: "controls-engineer", count: 1 }],
});
```

Axrail derives Adapter Policy/Validation scope from `executor.providerId`.

Before governance or external effect, Harness fails closed when:

- `providerId` is empty;
- the matching Adapter is not mounted;
- a ChangeSet Artifact declares a different provider.

Do not reintroduce a separate trusted `adapterId` for high-level mutation routing.

## 11. Transaction mode must match product reality

Choose one:

### `atomic`

Use only when the product can stage the change without exposing partial durable state and then commit atomically.

### `compensating`

Use when effects may occur during apply, but the Adapter has a real compensating operation that can undo them.

### `best_effort`

Use when rollback cannot be guaranteed.

Never call an integration `atomic` only because the implementation performs one API call. The semantic question is whether externally observable engineering state is atomic.

## 12. Policy

Adapter Policy answers: **is this engineering operation allowed?**

Typical policy inputs include:

- environment (`design`, `test`, `production`);
- actor identity;
- risk level;
- Adapter/provider identity;
- target resource;
- transaction mode;
- project or runtime target classification.

For privileged mutation, missing/ambiguous governance should fail closed.

The first integration may use a small policy set. It should still demonstrate at least one allowed path and one denied or approval-required path.

## 13. Validation

Validation answers: **is this engineering change technically valid?**

Recommended stages:

```text
schema
semantic
domain
adapter
safety
post_execution
```

Examples for HMI:

- screen/component ID exists;
- component type is supported;
- layout/property values are valid;
- tag/binding source exists and type is compatible;
- no duplicate screen/component identity;
- product-specific constraints are satisfied;
- deployment target supports required features.

Policy approval does not replace technical validation.

## 14. Approval

Approval must bind to the exact ChangeSet evidence.

When policy requires approval, Axrail binds approval to the canonical ChangeSet digest. If the approved ChangeSet changes, stale approval must not authorize the new content.

Your first integration should demonstrate one approval-required L2 engineering mutation.

The product UI may render the approval experience, but the approval decision must remain bound to the same immutable evidence executed by Axrail.

## 15. Preview

Preview is optional but must be truthful.

Good preview outputs include:

- normalized diff;
- rendered screen snapshot/reference;
- list of affected screens/components/bindings;
- native product change preview;
- warnings about unsupported/degraded features.

If product preview is incomplete, report `compatible` or `degraded` with notes. If no reliable preview exists, report `unsupported`.

Do not return ordinary current-state rendering and label it as a preview of the proposed ChangeSet unless it actually includes the proposed change.

## 16. Verification and commit

After `apply`, `verify` should check the intended postcondition rather than merely confirm that the API returned HTTP 200/success.

Examples:

- created screen exists with expected stable ID;
- component exists with expected semantic type/properties;
- binding resolves to intended tag/source;
- native staged change matches the ChangeSet;
- project version changed only when expected.

Commit should represent the point at which the change becomes durable/authoritative according to product semantics.

## 17. Failure, rollback and uncertainty

At least one failure path is required in the first integration.

Recommended cases:

```text
validation failure
version conflict
approval denial
apply failure
verify failure
commit failure
rollback/compensation failure
```

Rules:

1. Do not declare rollback success unless the target confirms it.
2. Do not automatically retry an uncertain external effect unless idempotence and target state are proven.
3. If the product may already have applied a change when a timeout occurs, report that uncertainty to Axrail instead of converting it into a normal retry-safe failure.
4. Keep deterministic machine safety controls outside the model and outside software-only approval assumptions.

## 18. Recommended first-pass implementation order

### Phase A — Integration facts

Return to Axrail:

- target repository/module identifier;
- integration module/path;
- product version;
- available SDK/API/extension mechanism;
- authentication model (describe, do not send secrets);
- native project/version/revision mechanism.

### Phase B — Adapter + capability manifest

Implement Adapter lifecycle and truthful capability manifest. Mount successfully in `HarnessRuntime`.

### Phase C — Read-only slice

Implement:

```text
project Artifact
project inspect
screen/project Context
```

No writes yet.

### Phase D — One ChangeSet mutation

Pick one low-complexity L2 engineering mutation, preferably:

```text
screen create
or
component add/update
```

Do not start with deployment or physical runtime actions.

### Phase E — Preview + Validation

Implement preview if real support exists and at least one product-specific validator.

### Phase F — Governed execution

Run the ChangeSet through provider-bound `executeChangeSet()` with Policy, Validation, Approval where required, apply, verify and commit.

### Phase G — Failure/recovery

Exercise one truthful failure/recovery case.

### Phase H — Feedback

Complete the provided feedback template and return it to the Axrail team.

## 19. Minimum acceptance checklist

The receiving team should not report the first integration pass complete until all applicable items are checked:

- [ ] Adapter has one stable provider ID.
- [ ] Adapter mounts and unmounts cleanly.
- [ ] Capability manifest reports exact/compatible/degraded/unsupported truth.
- [ ] Project Artifact uses the same provider ID as the effecting executor.
- [ ] Real project/version token is exposed through ArtifactProvider.
- [ ] Project inspect works through a governed read Tool or explicit Adapter read boundary.
- [ ] Context retrieval is explicit and provider-scoped.
- [ ] Sensitive Context is excluded by default.
- [ ] One L2 engineering mutation is represented as a ChangeSet.
- [ ] The mutation uses `ProviderBoundTransactionExecutor`.
- [ ] Policy/Validation scope is derived from the executor provider.
- [ ] Conflicting Artifact provider fails before effect.
- [ ] At least one product-specific validator is exercised.
- [ ] Approval is exercised when policy requires it.
- [ ] Preview is truthful or explicitly degraded/unsupported.
- [ ] Version conflict/concurrency behavior is defined.
- [ ] Transaction mode reflects actual product semantics.
- [ ] Apply verifies real postconditions.
- [ ] One failure/recovery path is exercised.
- [ ] No proprietary schema, credentials or customer data is committed to public Axrail.
- [ ] Feedback template is completed.

## 20. What to return after the first attempt

Use [feedback-template.md](feedback-template.md).

The most useful feedback is not only "worked / did not work". Please report:

- which Axrail concepts mapped naturally to the product;
- which concepts required translation;
- which contracts were ambiguous;
- any place where Axrail forced unnecessary product-specific leakage;
- any missing capability needed for a real engineering workflow;
- whether `providerId`, Artifact identity/version, Context, ChangeSet and transaction mode were easy to model;
- whether preview/validation/approval ordering matched the product lifecycle;
- any failure/uncertainty case that Axrail currently cannot express truthfully;
- concrete API changes you recommend, with product-specific details redacted when necessary.

## 21. Security and data handling

Do not place the following in public Axrail issues, examples, test fixtures or feedback:

```text
credentials / tokens
customer project files
customer names
private endpoints
private SDK source
proprietary full schemas
production deployment details
safety PLC logic
secrets embedded in HMI projects
```

When reporting a protocol gap, provide the smallest sanitized example that demonstrates the issue.

## 22. Existing reference material

Useful repository references:

- `examples/hmi-agent` — vendor-neutral HMI transaction example;
- `packages/hmi-adapter-kit` — HMI capability, Tool, Artifact and manifest helpers;
- `packages/adapter-sdk` — Adapter lifecycle, Context and provider registration;
- `packages/harness` — high-level composition and provider-bound ChangeSet execution;
- RFC-0006 — Adapter Protocol;
- RFC-0009 — Transactional Mutation Pipeline.

The purpose of the first real integration is to challenge these contracts with a real product. Integration feedback is expected to change future Axrail APIs; the current post-RC high-level API is intentionally pre-stable.
## 23. Canvas selection and AI scoped editing

A product with only one AI chat surface can still support OpenDesign-style select/box-select on the canvas and then continue editing through natural language.

```text
Product-owned editor interaction
click / multi / region / hit testing
stable screen/component IDs
             ↓
      SelectionContext
             ↓
 explicit Adapter Context
             ↓
        AI request
             ↓
          ChangeSet
             ↓
Policy / Validation / Approval
             ↓
         Transaction
             ↓
       private HMI Adapter
```

Axrail does not own canvas rendering, mouse gestures, hit testing, selection overlays, drag/resize, zoom/pan or editor panels.

Axrail owns the explicit request-level `SelectionContext`, provider/target provenance, HMI selection normalization and the governed mutation path after a ChangeSet exists.

### Explicit snapshot per AI turn

Freeze the current editor selection when the user submits the AI message:

```ts
const selection = hmiRegionSelection({
  selectionId: "sel:456",
  providerId: "your-hmi",
  projectId: "project:123",
  screenId: "screen:overview",
  componentIds: ["pump-101", "valve-102"],
  bounds: {
    x: 100, y: 60, width: 600, height: 300,
    coordinateSpace: "screen:overview",
  },
});

const fragments = await harness.adapters.buildContext(
  {
    purpose: "scoped-edit",
    artifactIds: ["project:123"],
    selection,
  },
  { adapterIds: ["your-hmi"], includeSensitive: false },
);
```

Current Axrail does not automatically inject arbitrary Adapter Context into the model prompt. The first integration should explicitly include the normalized selection fragments in the product's AI request assembly.

### Stable IDs are authoritative

The product performs hit testing and returns stable engineering object IDs. Coordinates are supporting evidence, not durable target identity.

A blank region may contain no component targets and can still express placement intent such as “put a trend chart here”. The resulting ChangeSet should target a stable screen/project and use the region as layout context.

### Selection is not authorization

Selection narrows user intent. It does not bypass Policy, Validation, Approval or Transaction.

## 24. Product-side design input before real integration

Before implementing the private Adapter, complete [Product Selection / AI Scoped-Editing Design Input](product-selection-design-input.md).

The design input should describe AI chat lifecycle, canvas/renderer topology, click/multi/region selection, hit testing, stable engineering IDs, coordinate transforms, selected-object read APIs, revision/version semantics, preview/apply/verify/save APIs, rollback/compensation and process/iframe/webview/native boundaries.

Related protocol: RFC-0010 Interactive Selection Context and `docs/architecture/interactive-selection-scoped-editing.md`.


## 25. Use the Interaction SDK for reusable AI chat integration

When multiple third-party engineering products integrate with Axrail, do not reimplement the AI Chat → Context → Selection → Agent glue independently in each product.

The post-RC `@axrail/interaction-sdk` provides a headless `InteractionRuntime` with explicit selection snapshots, Adapter/plugin Context collection, bounded context envelopes, normalized events and typed InteractionPlugin extensions.

Plugins may extend context and observe turn/events, but cannot bypass Policy, Validation, Approval, Transaction or provider-bound execution.

The first implementation is turn-oriented. Persisted multi-turn continuation is intentionally not frozen yet; it should later converge on authoritative Harness Session/Event semantics rather than create a competing transcript truth.

See `docs/architecture/interaction-sdk-plugin-architecture.md` and RFC-0011.


## 26. Model integration and switching

Do not put model selection in the HMI Adapter or Harness.

Use:

```text
Product Model Picker
      ↓ modelId
@axrail/interaction-sdk
  ModelRegistry
  capability checks
  provenance
      ↓
AgentModelProvider
      ↑
@axrail/model-* / private provider
      ↓
@axrail/agent
      ↓
@axrail/harness
```

Build the UI picker from `interaction.models.list()` and pass `modelId` explicitly on each turn.

Applications may persist user preference outside InteractionRuntime. Avoid shared mutable global model state.

Use `requiredModelCapabilities` when a turn requires capabilities such as tool calling, reasoning or vision; missing/unknown support fails closed before model execution.

Model credentials remain inside concrete providers and are not copied into descriptors, Context, Selection or events.

See RFC-0012 and `docs/architecture/model-registry-runtime-selection.md`.

## 27. Preferred v0.2 model-provider integration

For post-RC/v0.2 integrations, prefer `@axrail/model-ai-sdk` backed by the Vercel AI SDK provider ecosystem rather than maintaining one Axrail HTTP client per model vendor.

The product creates the concrete AI SDK `LanguageModel` using the provider package it needs, wraps it in `AiSdkModelProvider`, and registers it with the Interaction ModelRegistry.

Credentials stay in provider configuration/secret resolution and are never copied into Axrail model descriptors, Context, Selection or events.

The bridge intentionally provides Tool schemas without execute handlers. AI SDK may request a Tool, but Axrail AgentLoop/ToolRuntime remains the only engineering Tool execution path.

v0.2 requires Node.js >=22.13.0. Published npm 0.1.0-rc.1 remains the historical Node >=20 release.
