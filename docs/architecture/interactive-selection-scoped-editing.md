# Interactive Selection and Scoped HMI Editing

Status: **post-RC architecture foundation**

This document records the architecture for OpenDesign-style “select on canvas, then continue editing through AI” behavior in Axrail integrations.

## Boundary

```text
AI-native HMI / configuration product
┌─────────────────────────────────────────┐
│ Canvas / Editor                         │
│                                         │
│ click / multi / region selection        │
│ hit testing                             │
│ stable screen/component IDs             │
│ overlay / drag / resize / zoom          │
└──────────────────────┬──────────────────┘
                       │ explicit snapshot
                       ▼
┌─────────────────────────────────────────┐
│ Axrail Adapter SDK                      │
│ SelectionContext                        │
│ provider + target provenance            │
└──────────────────────┬──────────────────┘
                       ▼
┌─────────────────────────────────────────┐
│ HMI Adapter Kit                         │
│ HMI screen/component/region selection   │
│ hmi.selection.context                   │
└──────────────────────┬──────────────────┘
                       ▼
             Context / AI turn
                       ▼
                  ChangeSet
                       ▼
        Policy / Validation / Approval
                       ▼
                  Transaction
                       ▼
         ProviderBoundTransactionExecutor
                       ▼
               private HMI Adapter
```

The architecture follows `D-v02-interactive-selection-boundary`.

## Ownership

### HMI/product owns

- canvas rendering;
- mouse/touch/keyboard selection;
- box/lasso geometry;
- hit testing;
- mapping rendered objects to stable engineering IDs;
- selection overlays;
- drag/resize/snap;
- coordinate transforms;
- current editor selection state.

### Axrail owns

- explicit request-level selection snapshot;
- provider scope;
- target provenance;
- optional geometry evidence;
- normalized HMI selection helpers;
- transport through Adapter Context;
- governed durable mutation after the Agent proposes a ChangeSet.

## No hidden selection state in Harness

Axrail does not add `setSelection()` or a global mutable selection registry to `HarnessRuntime`.

The embedding application snapshots the editor state for the current AI turn and passes it explicitly.

This prevents stale selection from affecting later requests and keeps session/UI lifetime under product control.

## Geometry is evidence, not engineering identity

The product performs hit testing.

```text
rectangle → [component IDs]
```

Axrail does not perform:

```text
rectangle → infer component IDs
```

Region geometry can still be useful for:

- placement of a new component;
- preview;
- explaining user intent;
- design/layout reasoning.

But existing-object mutation must use stable engineering identifiers.

## Selection is not governance

Selection narrows intent; it does not authorize effects.

```text
Selection
  ↓
Context
  ↓
Change Proposal
  ↓
ChangeSet
  ↓
Policy / Validation / Approval
  ↓
Transaction
```

The existing Transactional Mutation model remains unchanged.

## Context Assembly boundary

Current Adapter Context retrieval is explicit. The HMI embedding application is responsible for including the returned normalized selection context in the model turn.

Future Context Assembly may automate budget/provenance/sensitivity-aware model input, but this Selection protocol does not require Harness to auto-inject Context.

## HMI receiving-team requirement

Before real integration, the product team must provide a design description covering:

- AI chat entry point;
- editor/renderer topology;
- click/multi/box-selection event model;
- hit-testing and stable IDs;
- project/screen/component data model;
- coordinate transforms;
- selected-object property/binding read APIs;
- revision/version semantics;
- preview/apply/verify/save APIs;
- undo/rollback/compensation semantics;
- iframe/webview/native/thread boundaries.

Use the template in `docs/integrations/ai-native-hmi/product-selection-design-input.zh-CN.md`.

## Related

- RFC-0010 Interactive Selection Context
- RFC-0009 Transactional Mutation Pipeline
- AI-native HMI integration guide
- `@axrail/adapter-sdk`
- `@axrail/hmi-adapter-kit`
