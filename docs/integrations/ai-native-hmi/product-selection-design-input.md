# Product Selection / AI Scoped-Editing Design Input

This template is completed by the receiving AI-native HMI/configuration product team before the real Adapter vertical slice.

Do not include credentials, customer project files, private endpoints or full proprietary schemas.

## 1. Product and integration module

- Product/version:
- Repository/workspace:
- Axrail Adapter module/path:
- AI chat module/path:
- Runtime/editor technology:

## 2. AI chat lifecycle

Describe how a user message obtains current project, screen and selection state, how the model/Axrail request is assembled, and which module applies the resulting engineering change.

## 3. Canvas/editor architecture

Describe renderer technology, iframe/webview/native boundaries, design vs preview renderers, and whether renderer nodes map directly to engineering objects.

## 4. Selection interaction

Document click selection, multi-selection and region/box/lasso selection, including event payloads and hit-testing APIs.

## 5. Stable engineering identity

Document stable project, screen, component and binding IDs, including persistence, copy/paste and undo/redo behavior. Pixel coordinates must not be the only target identity.

## 6. Coordinate system

Document origin, zoom, pan, transforms, nested containers and how a UI region becomes Axrail SelectionBounds.

## 7. Selected-object context

List properties, bindings, tags, alarms, animations, scripts/expressions and other normalized engineering facts available for a selected object. Mark sensitive fields.

## 8. Selection event to Axrail

Describe how a selection snapshot is frozen at AI-send time and how selection/request races are prevented.

Recommended normalized facts:

```text
selectionId
providerId
source
mode
projectId
screenId
componentIds
bounds
timestamp
```

## 9. Read APIs

Document project/screen/component inspection, selected properties, binding/tag lookup, available component types and revision/version APIs.

## 10. Mutation APIs

Document add/update/move/resize/multi-object layout/binding/screen mutations, batch APIs, staging/edit sessions, save and commit behavior.

## 11. Preview and verification

Document real preview/diff capability and post-apply verification APIs.

## 12. Version and concurrency

Document project/component revision tokens, concurrent editing behavior and stale/deleted selected-object behavior.

## 13. Undo / rollback / compensation

Document native undo, rollback, transaction/edit session, crash recovery and failure semantics so Axrail can choose atomic, compensating or best_effort truthfully.

## 14. First scoped-edit scenario

Choose one real low-risk L2 engineering mutation, such as multi-component alignment, selected-component style/property update, binding update, or creating a component in a selected blank region.

## 15. Feedback to Axrail

Report fields that are hard to map, missing target types/context, ChangeSet friction, degraded/unsupported capabilities and recommended public API changes.
