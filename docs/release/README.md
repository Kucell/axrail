# Axrail Release Hardening

This directory is the release-readiness entry point for Axrail v0.1.

Axrail's functional v0.1 scope is implemented. The current work is about turning that source-workspace implementation into an intentional, installable and repeatable first public release without freezing unfinished architecture by accident.

## Current state

```text
Functional v0.1 scope             ✓ complete
Governed-execution P1 gate #19    ✓ passed / closed
Architecture P2 follow-up #20     ✓ resolved or explicitly scoped / closed
Node 20/22/24 source CI           ✓ green
Frozen pnpm lockfile              ✓ enforced
Public API review #17             ✓ proposal complete / final decision open
Package build #15                 analysis + package graph complete / decision open
Versioning/release #18            policy draft complete / decision open
Pack/install smoke #16            smoke matrix defined / waits on #15 artifacts
```

## Release documents

- [`v0.1-readiness.md`](v0.1-readiness.md) — release-readiness audit and blockers.
- [`v0.1-public-api.md`](v0.1-public-api.md) — proposed supported package/API surface.
- [`v0.1-build-strategy-analysis.md`](v0.1-build-strategy-analysis.md) — build architecture comparison and recommendation.
- [`v0.1-package-graph.md`](v0.1-package-graph.md) — proposed package dependency topology, build layers, and clean-consumer smoke matrix.
- [`v0.1-versioning-release-policy.md`](v0.1-versioning-release-policy.md) — release/versioning/tag/dry-run policy draft.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — human-readable release-note source of truth.

## Open development decisions

These remain intentionally open in `Kucell/axrail-agent` and must not be silently treated as approved:

### `D-v01-public-api-surface`

Proposed direction:

- `@axrail/harness` is the primary application/runtime surface;
- `@axrail/adapter-sdk` is the primary engineering-system integration SDK;
- protocol/runtime primitives are separately publishable;
- `@axrail/core` stays experimental/internal for v0.1.

Gate: #17.

### `D-v01-package-build-strategy`

Current recommendation:

> TypeScript project references / native `tsc -b` NodeNext ESM + declaration emit.

The recommendation preserves public package boundaries rather than bundling the SDK graph by default.

Gate: #15.

### `D-v01-versioning-release-policy`

Current recommendation:

> Use lockstep public-package versions for the v0.1 release line, while keeping serialized protocol versions independent.

Gate: #18.

## What happens after the decisions are approved

The intended implementation order is:

```text
approve public package set (#17)
        ↓
approve build strategy (#15)
        ↓
add tsc/project-reference build graph
        ↓
emit dist JS + declarations
        ↓
normalize package exports/files/bin
        ↓
pnpm pack each publish candidate
        ↓
clean consumer install/import smoke
        ↓
complete #16
        ↓
approve version/release model (#18)
        ↓
release dry run (no publish)
        ↓
inspect artifacts
        ↓
0.1.0-rc.1 candidate
```

No registry publishing or Git release/tag automation should be enabled before the relevant decisions and dry-run gates are complete.

## Safety and compatibility reminder

Release hardening must not weaken governed execution in order to make packaging simpler. In particular:

- Tool Policy/Approval remain bound to immutable invocation evidence;
- Transaction approval evidence remains immutable and rechecked;
- Provider ambiguity remains fail-closed;
- Policy obligations and approval quorum remain enforced;
- strict audit profiles retain pre-effect/pre-commit checkpoints;
- Adapter/validator/provider scoping remains explicit;
- L4/L5 risk floors are not build-time configuration options.

A package that installs correctly but bypasses these runtime guarantees is not a valid Axrail release artifact.
