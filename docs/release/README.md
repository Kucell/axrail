# Axrail Release Hardening

This directory is the release-readiness entry point for Axrail v0.1.

Axrail's functional v0.1 scope is implemented, the first installable release-candidate artifacts have passed no-publish package verification, and a final pre-release architecture review has now been completed.

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
Pre-release architecture #21      ✗ P1 release gate open
Version/release automation #18    ◐ publication mechanics remain open
```

**Public npm/GitHub release is currently NO-GO until Issue #21 is closed and re-reviewed.**

No Axrail package has been published to an npm registry by this work.

## Release documents

- [`v0.1-readiness.md`](v0.1-readiness.md) — current release-readiness state and remaining publication work.
- [`v0.1-public-api.md`](v0.1-public-api.md) — approved supported package/API surface.
- [`v0.1-build-strategy-analysis.md`](v0.1-build-strategy-analysis.md) — approved build architecture analysis.
- [`v0.1-package-graph.md`](v0.1-package-graph.md) — package dependency topology, build layers, and clean-consumer smoke matrix.
- [`v0.1-versioning-release-policy.md`](v0.1-versioning-release-policy.md) — approved v0.1 versioning/tag/release policy.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — human-readable release-note source of truth.
- `Kucell/axrail-agent/ARCHITECTURE_REVIEW_PRE_RELEASE_2026-09-16.md` — final pre-release architecture review and release verdict.

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
65 behavioral tests
        ↓
pnpm pack all 15 public packages
        ↓
clean npm consumer install
        ↓
import every public package root
        ↓
packaged axrail --version
```

This runtime/package smoke is green on Node 20, 22 and 24, and package tarballs include Apache-2.0 license text.

The pre-release architecture review found one additional release-verification gap: the clean consumer must also compile representative TypeScript against the packed `.d.ts` files with `skipLibCheck: false`, and package dependency closure must be verified without relying on all 15 tarballs being installed together. This is tracked by #21.

## Pre-release architecture gate #21

The release is blocked until these four P1 findings are closed and rechecked:

1. Transaction lifecycle observers must not change already-committed outcome semantics.
2. Tool timeout must model/cancel effect uncertainty instead of returning an ordinary execution failure while the Tool may still run.
3. Adapter Policy providers need Host-enforced scope and complete multi-Adapter Transaction policy coverage (or v0.1 must fail-closed prohibit multi-Adapter Transactions).
4. Packed artifacts need downstream TypeScript/declaration and dependency-closure consumer verification.

After implementation, Node 20/22/24 build/tests/package smoke plus a focused architecture re-review must pass before publication work resumes.

## Remaining publication work

Issue #18 remains open for publication mechanics and is downstream of #21:

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
- Adapter/validator/provider scoping remains explicit;
- L4/L5 risk floors are not build-time configuration options.

A package that installs correctly but bypasses these runtime guarantees is not a valid Axrail release artifact.
