# Axrail Release Hardening

This directory is the release-readiness entry point for Axrail v0.1.

Axrail's functional v0.1 scope is implemented, the first installable release-candidate artifacts have passed no-publish package verification, the final pre-release architecture Gate has passed focused re-review, the post-RC hardening follow-up is complete, and repository-side publication workflows are implemented.

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
0.1.0-rc.1 no-publish dry run     ✓ package/runtime/TS smoke green
Pre-release architecture #21      ✓ focused re-review passed / closed
Post-RC hardening #22             ✓ completed / closed
Publication workflows #18         ✓ repository-side mechanics implemented
External npm/GitHub setup         ◐ required before first public publish
Actual public release             ✗ not executed
```

**Architecture, hardening and repository automation Gates are GO. Axrail remains unpublished until the npm scope, protected GitHub Environments, first-release bootstrap credentials, and explicit maintainer publication action are configured/executed.**

No Axrail package has been published to an npm registry by this work.

## Release documents

- [`v0.1-readiness.md`](v0.1-readiness.md) — current release-readiness state and remaining external publication setup.
- [`npm-publication.md`](npm-publication.md) — operational first-publish bootstrap, Trusted Publisher, staged publishing, 2FA approval, and GitHub Release runbook.
- [`notes/v0.1.0-rc.1.md`](notes/v0.1.0-rc.1.md) — prepared RC1 GitHub Release notes.
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
behavioral tests
        ↓
dependency-closure audit over emitted .js/.d.ts
        ↓
pnpm pack all 15 public packages
        ↓
clean npm consumer install
        ↓
import every public package root
        ↓
import documented Adapter SDK advanced subpaths
        ↓
strict NodeNext TypeScript consumer compile
        ↓
packaged axrail --version
```

CI #222 / Actions run `35093490803` passed the hardened runtime/package flow on Node 20, 22 and 24 with 73 behavioral tests. Publication workflow invariants are additionally covered by normal behavioral tests so later workflow edits cannot silently remove required Environments, OIDC, environment guards, immutable Action pins, or registry-before-tag ordering.

## Publication architecture

Because npm Trusted Publishing and staged publishing require a package to already exist, Axrail separates first publication from future releases:

```text
First release
  release-bootstrap.yml
    → verify exact tarballs
    → protected npm-release-bootstrap Environment
    → RELEASE_GUARD=enabled
    → temporary NPM_TOKEN
    → npm publish --tag rc --provenance
    → revoke token

Future releases
  release-stage.yml
    → verify exact tarballs
    → protected npm-release Environment
    → RELEASE_GUARD=enabled
    → OIDC Trusted Publisher
    → npm stage publish
    → npm maintainer 2FA approval

After all npm packages are public
  release-finalize.yml
    → protected github-release Environment
    → RELEASE_GUARD=enabled
    → verify all 15 registry versions
    → annotated Git tag
    → GitHub Release
```

The verified tarballs uploaded before an Environment approval are the same files consumed by the side-effecting publish/stage job; release jobs do not rebuild after approval.

All third-party Actions in CI/release workflows are pinned to immutable commit SHAs.

## External setup still required

Before the first public release, Issue #18 tracks the remaining account-level actions:

- verify/create npm ownership of the `@axrail` scope and all 15 names;
- enable npm maintainer 2FA;
- configure protected GitHub Environments `npm-release-bootstrap`, `npm-release`, and `github-release`;
- set `RELEASE_GUARD=enabled` on each Environment;
- put only the one-time short-lived bootstrap token in `npm-release-bootstrap` as `NPM_TOKEN`;
- explicitly approve/run the bootstrap publication;
- revoke the bootstrap token immediately after success;
- configure each package's Trusted Publisher for `release-stage.yml` + `npm-release`, stage-only;
- require 2FA and disallow traditional token publishing after Trusted Publishing is verified;
- explicitly approve future staged packages with npm 2FA;
- explicitly finalize the GitHub Release.

## Safety and compatibility reminder

Release hardening must not weaken governed execution in order to make packaging simpler. In particular:

- Tool Policy/Approval remain bound to immutable invocation evidence;
- Transaction approval evidence remains immutable and rechecked;
- Provider ambiguity remains fail-closed;
- Policy obligations and approval quorum remain enforced;
- strict audit profiles retain pre-effect/pre-commit checkpoints;
- Adapter/validator/policy/provider scoping remains explicit;
- timeout or failed postcondition of a side-effecting Tool can mean effect uncertainty, not proven absence of effect;
- L4/L5 risk floors are not build-time configuration options.

A package that installs correctly but bypasses these runtime guarantees is not a valid Axrail release artifact.
