# Axrail Release Hardening

This directory is the release-readiness entry point for Axrail v0.1.

Axrail's functional v0.1 scope is implemented, the first installable release-candidate artifacts have passed no-publish package verification, and the final pre-release architecture Gate has passed focused re-review.

## Current state

```text
Functional v0.1 scope             ✓ complete
Governed-execution P1 gate #19    ✓ passed / closed
Architecture P2 follow-up #20     ✓ resolved or explicitly scoped / closed
Public API review #17             ✓ approved / applied / closed
Package build #15                 ✓ tsc -b ESM+d.ts / closed
Pack/install smoke #16            ✓ Node 20/22/24 / closed
Frozen pnpm lockfile              ✓ enforced
v0.1 lockstep version model       ✓ approved
0.1.0-rc.1 no-publish dry run     ✓ package/runtime smoke green
Pre-release architecture #21      ✓ focused re-review passed / closed
Version/release automation #18    ◐ publication mechanics remain open
```

**Architecture release Gate: GO. Axrail remains unpublished until #18's explicit publication mechanics and maintainer publish decision are completed.**

No Axrail package has been published to an npm registry by this work.

## Release documents

- [`v0.1-readiness.md`](v0.1-readiness.md) — current release-readiness state and remaining publication work.
- [`v0.1-public-api.md`](v0.1-public-api.md) — approved supported package/API surface.
- [`v0.1-build-strategy-analysis.md`](v0.1-build-strategy-analysis.md) — approved build architecture analysis.
- [`v0.1-package-graph.md`](v0.1-package-graph.md) — package dependency topology, build layers, and clean-consumer smoke matrix.
- [`v0.1-versioning-release-policy.md`](v0.1-versioning-release-policy.md) — approved v0.1 versioning/tag/release policy.
- [`../execution-semantics.md`](../execution-semantics.md) — safety-relevant runtime boundary semantics for observers, timeout uncertainty, Adapter Policy isolation, and consumer verification.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — human-readable release-note source of truth.
- `Kucell/axrail-agent/ARCHITECTURE_REVIEW_PRE_RELEASE_2026-09-16.md` — pre-release review that opened #21.
- `Kucell/axrail-agent/ARCHITECTURE_REVIEW_PRE_RELEASE_RECHECK_2026-09-16.md` — focused re-review that cleared #21.

## Approved development decisions

The following release gates are recorded as **approved** in `Kucell/axrail-agent`:

### `D-v01-public-api-surface`

- `@axrail/harness` is the primary application/runtime surface;
- `@axrail/adapter-sdk` is the primary engineering-system integration SDK;
- protocol/runtime primitives remain separately importable;
- `@axrail/core` stays private/experimental/internal for v0.1.

### `D-v01-package-build-strategy`

Axrail uses TypeScript project references / native `tsc -b` with NodeNext ESM and declaration emit. SDK packages are not bundled by default.

### `D-v01-versioning-release-policy`

The 15 supported public packages use lockstep versions for the v0.1 line. The current prepared candidate is `0.1.0-rc.1`; serialized protocol versions remain independent.

## Implemented package/release verification

Every supported Node line runs:

```text
pnpm install --frozen-lockfile
        ↓
pnpm check
        ↓
tsc -b project-reference build
        ↓
69 behavioral tests
        ↓
dependency-closure audit over emitted .js/.d.ts
        ↓
pnpm pack all 15 public packages
        ↓
clean npm consumer install
        ↓
import every public package root
        ↓
strict NodeNext TypeScript consumer compile
        ↓
packaged axrail --version
```

CI #206 / Actions run `35090615025` passed the full flow on Node 20, 22 and 24. The packaged CLI reports `0.1.0-rc.1`.

## Final pre-release architecture Gate #21 — PASSED

The focused re-review closed the four release blockers:

1. Transaction lifecycle observers are observational and cannot relabel an already committed effect.
2. Tool timeout uses cooperative timeout-scoped cancellation and returns explicit `timeout` / `execution_uncertain` semantics.
3. Adapter Policy providers are Host-scoped and multi-Adapter Transactions evaluate every Adapter policy scope with conservative aggregation.
4. Packed artifacts pass strict downstream TypeScript declaration compilation and emitted dependency-closure verification.

No new P1 regression was found in the focused re-review. Remaining architecture hardening is tracked as non-blocking follow-up rather than a release Gate.

## Remaining publication work

Issue #18 remains open for publication mechanics only:

- Git tag and GitHub Release creation workflow;
- npm authentication via repository environments/secrets;
- provenance/signing/attestation where supported;
- final maintainer approval before registry publication;
- first real package publication.

The no-publish manual dry-run workflow remains intentionally unable to create tags/releases or publish packages.

## Safety and compatibility reminder

Release hardening must not weaken governed execution in order to make packaging simpler. In particular:

- Tool Policy/Approval remain bound to immutable invocation evidence;
- Transaction approval evidence remains immutable and rechecked;
- Provider ambiguity remains fail-closed;
- Policy obligations and approval quorum remain enforced;
- strict audit profiles retain pre-effect/pre-commit checkpoints;
- Adapter/validator/policy/provider scoping remains explicit;
- timeout of a side-effecting Tool means effect uncertainty, not proven absence of effect;
- L4/L5 risk floors are not build-time configuration options.

A package that installs correctly but bypasses these runtime guarantees is not a valid Axrail release artifact.
