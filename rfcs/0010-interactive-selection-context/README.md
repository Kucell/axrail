# RFC 0010: Interactive Selection Context and Scoped Editing

Status: **Draft / implemented foundation on post-RC main**

## Summary

Axrail defines an explicit, provider-scoped Selection Context so an engineering editor can pass click, multi-selection, or region/box-selection state into AI context without making the Harness responsible for canvas interaction.

The owning product remains responsible for rendering, hit testing, overlays, mouse/keyboard behavior, and mapping pixels to stable engineering object identifiers.

Axrail owns the portable selection snapshot and the governed mutation path that may follow from it.

```text
HMI / Engineering Editor
  click / multi / box / hit test
              ↓
stable engineering object IDs
              ↓
       SelectionContext
              ↓
 explicit Adapter Context / AI request
              ↓
       change proposal
              ↓
          ChangeSet
              ↓
Policy / Validation / Approval
              ↓
        Transaction
              ↓
 provider-bound Adapter effect
```

## 1. Problem

AI-native engineering products often have one AI chat surface next to a visual editor. Users naturally expect to select an object or drag a rectangle over several objects and then say:

> Move these to the left and make abnormal state red.

Without a standard contract, integrations tend to pass opaque product-private metadata or pixel coordinates directly to a model. That creates several problems:

- selection provenance is unclear;
- provider scope may be lost;
- coordinates can be mistaken for durable target identity;
- stale selection can leak between requests;
- a product may accidentally treat selection as authorization;
- every HMI integration invents a different scoped-editing shape.

Axrail needs a portable selection contract without becoming a GUI framework.

## 2. Architectural decision

The approved boundary is:

> **The product owns interaction. Axrail owns selection semantics and governed mutation.**

Product-owned responsibilities:

- Canvas / renderer;
- click / multi / lasso / rectangle interaction;
- hit testing;
- hover / focus / selection overlays;
- drag / resize / snapping;
- coordinate transforms, zoom and pan;
- layer/property panels;
- mapping rendered elements to stable engineering object IDs.

Axrail-owned responsibilities:

- explicit Selection Context snapshot;
- provider identity;
- stable target references;
- optional region/bounds evidence;
- selection provenance;
- Adapter Context transport;
- ChangeSet target binding;
- Policy / Validation / Approval / Transaction after a proposed mutation exists.

`@axrail/harness` must not acquire canvas or hit-testing dependencies.

## 3. Selection is not authorization

A Selection Context is contextual evidence for the current user request.

It is **not**:

- an Approval;
- a Policy decision;
- a permission grant;
- an execution capability token;
- a durable mutation;
- a replacement for a ChangeSet target.

A user selecting `pump-101` does not authorize changing `pump-101`.

Durable engineering mutation must still become an explicit ChangeSet and execute through the normal governed path.

## 4. Generic contract

The post-RC Adapter SDK exposes a conceptual contract equivalent to:

```ts
interface SelectionContext {
  selectionId: string
  providerId: string
  source: string
  mode: "single" | "multiple" | "region"
  targets: SelectionTarget[]
  bounds?: SelectionBounds
  timestamp?: string
  metadata?: Record<string, unknown>
}

interface SelectionTarget {
  targetId: string
  targetType: string
  artifactId?: string
  parentId?: string
  metadata?: Record<string, unknown>
}
```

A Selection Context is scoped to exactly one provider in this protocol iteration.

Multi-provider selection is intentionally deferred.

## 5. Stable engineering identity

The editor must perform hit testing and return stable engineering IDs.

Preferred:

```text
mouse rectangle
   ↓
product hit testing
   ↓
screenId + componentIds
   ↓
SelectionContext
```

Not acceptable as the only identity:

```text
x=120, y=80, width=500, height=300
```

Coordinates may be included as evidence, placement hints, or preview context, but Axrail must not infer durable engineering targets from pixel geometry.

## 6. Region selection

Region mode requires bounds.

A region may contain resolved targets:

```text
region
  ├─ pump-101
  ├─ valve-102
  └─ label-103
```

A region may also be blank. This supports requests such as:

> Put a trend chart in this area.

In that case, the final ChangeSet should target a stable parent/screen artifact and use the region only as placement context.

## 7. Explicit request scoping

Selection is passed explicitly with the current request.

```ts
await harness.adapters.buildContext(
  {
    purpose: "scoped-edit",
    artifactIds: ["project:123"],
    selection,
  },
  {
    adapterIds: ["your-hmi"],
  },
)
```

Axrail does not maintain an implicit global selection session in Harness.

This avoids stale UI state silently affecting later Agent turns.

## 8. HMI domain mapping

`@axrail/hmi-adapter-kit` standardizes common HMI selection forms:

- screen selection;
- single component selection;
- multiple component selection;
- region selection with resolved component IDs;
- blank region selection;
- normalized `hmi.selection.context` Adapter Context fragment.

Example:

```ts
const selection = hmiRegionSelection({
  selectionId: "sel:456",
  providerId: "your-hmi",
  projectId: "project:123",
  screenId: "screen:overview",
  componentIds: ["pump-101", "valve-102"],
  bounds: {
    x: 100,
    y: 60,
    width: 600,
    height: 300,
    coordinateSpace: "screen:overview",
  },
})
```

## 9. Scoped editing

A product may assemble the current AI turn from:

```text
user prompt
+
current project/screen context
+
SelectionContext
+
normalized selected-object properties
+
bindings/tags allowed for the current scope
```

Current Axrail Context retrieval is explicit. Axrail does not yet automatically inject arbitrary Adapter Context into every model request.

A future Context Assembly layer may standardize provenance/budget/sensitivity-aware prompt assembly, but this RFC does not require that larger runtime feature.

## 10. Selection-to-ChangeSet rule

Selection should narrow the user's intended engineering scope.

The Agent/application must still construct explicit operations with stable targets.

```text
Selection:
  pump-101
  valve-102

User:
  align these horizontally

ChangeSet:
  update pump-101 layout
  update valve-102 layout
```

The ChangeSet is the durable proposal. The Selection Context is supporting evidence/context.

## 11. Provider binding

`SelectionContext.providerId` identifies the Adapter that produced/owns the selection.

The application should fail closed if it tries to use the snapshot in a different Adapter/provider scope.

When the selection becomes a durable mutation, the existing provider-bound Transactional Mutation invariant still applies:

```text
Selection provider
        =
target Adapter provider

and for effecting mutation:

ChangeSet Artifact.provider
        =
TransactionExecutor.providerId
```

## 12. Security and privacy

Selection metadata may reveal engineering structure.

Adapters should:

- avoid credentials/secrets;
- avoid dumping private full schemas;
- normalize only the selected engineering context needed for the request;
- respect existing sensitive Context defaults;
- keep customer/project proprietary data out of public logs/examples.

## 13. Non-goals

This RFC does not define:

- a canvas renderer;
- DOM/source mapping;
- iframe bridge protocol;
- mouse or keyboard gestures;
- selection overlay rendering;
- drag/resize behavior;
- editor undo UI;
- private HMI component schema;
- generic multi-provider selection;
- automatic model Context Assembly.

## 14. Validation target

The protocol is considered useful when a real AI-native HMI can implement:

```text
box select
   ↓
stable screen/component IDs
   ↓
SelectionContext
   ↓
AI scoped-edit request
   ↓
ChangeSet
   ↓
preview / validation
   ↓
provider-bound transaction
   ↓
verify / commit
```

The receiving HMI team should return its editor/selection/API design facts before the real vertical slice is finalized.
