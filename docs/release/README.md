# Axrail Release Hardening

This directory is the release-readiness entry point for Axrail v0.1.

Axrail's functional v0.1 scope, architecture gates, post-RC hardening, package verification, and repository-side publication workflows are complete. The first npm release candidate has also been published successfully. Remaining RC1 closeout is limited to account-level credential/Trusted Publisher cleanup and GitHub Release finalization.

## Current state

```text
Functional v0.1 scope                 ✓ complete
Governed-execution P1 gate #19        ✓ passed / closed
Architecture P2 follow-up #20         ✓ resolved or explicitly scoped / closed
Public API review #17                 ✓ approved / applied / closed
Package build #15                     ✓ tsc -b ESM+d.ts / closed
Pack/install smoke #16                ✓ Node 20/22/24 / closed
Frozen pnpm lockfile                  ✓ enforced
v0.1 lockstep version model           ✓ approved
0.1.0-rc.1 no-publish dry run         ✓ package/runtime/TS smoke green
Pre-release architecture #21          ✓ focused re-review passed / closed
Post-RC hardening #22                 ✓ completed / closed
Publication workflows #18             ✓ repository-side mechanics implemented
npm 0.1.0-rc.1 publication            ✓ 15/15 packages published with provenance
Bootstrap credential cleanup          ◐ pending account-side verification
Trusted Publisher migration           ◐ pending account-side verification
v0.1.0-rc.1 Git tag / GitHub release  ✗ not finalized
```

The 15 supported public packages are available on npm as `0.1.0-rc.1` under the `rc` dist-tag with GitHub Actions provenance. The published artifacts correspond to source commit:

```text
e4758656c20f6cb90b05eb3429c79010667a2f7d
```

The npm publication is complete. RC1 is not fully finalized until the exact source commit is tagged as `v0.1.0-rc.1` and the GitHub prerelease is created by the protected finalization workflow.

## Release documents

- [`v0.1-readiness.md`](v0.1-readiness.md) — current release-readiness state and remaining RC1 closeout.
- [`npm-publication.md`](npm-publication.md) — bootstrap history, Trusted Publisher setup, staged publishing, 2FA approval, and GitHub Release runbook.
- [`notes/v0.1.0-rc.1.md`](notes/v0.1.0-rc.1.md) — RC1 GitHub Release notes.
- [`v0.1-public-api.md`](v0.1-public-api.md) — approved supported package/API surface.
- [`v0.1-build-strategy-analysis.md`](v0.1-build-strategy-analysis.md) — approved build architecture analysis.
- [`v0.1-package-graph.md`](v0.1-package-graph.md) — package dependency topology, build layers, and clean-consumer smoke matrix.
- [`v0.1-versioning-release-policy.md`](v0.1-versioning-release-policy.md) — approved v0.1 versioning/tag/release policy.
- [`../execution-semantics.md`](../execution-semantics.md) — safety-relevant runtime boundary semantics for observers, timeout uncertainty, Adapter Policy isolation, and consumer verification.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — human-readable release-note source of truth.

## Approved v0.1 decisions

### Public API surface

- `@axrail/harness` is the primary application/runtime surface;
- `@axrail/adapter-sdk` is the primary engineering-system integration SDK;
- protocol/runtime primitives remain separately importable;
- `@axrail/core` stays private/experimental/internal for v0.1.

### Package build strategy

Axrail uses TypeScript project references / native `tsc -b` with NodeNext ESM and declaration emit. SDK packages are not bundled by default.

### Versioning and release policy

The 15 supported public packages use lockstep versions for the v0.1 line. The first published candidate is `0.1.0-rc.1`; serialized protocol versions remain independent.

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

CI validates Node 20, 22 and 24 with 73 behavioral tests. Publication workflow invariants are also covered by behavioral tests so later workflow edits cannot silently remove required Environments, OIDC/token boundaries, Environment guards, immutable Action pins, or registry-before-tag ordering.

## Publication architecture

The first package publication and all subsequent releases intentionally use different trust paths:

```text
First release — completed for 0.1.0-rc.1
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
    → verify exact source commit and release notes
    → annotated Git tag
    → GitHub Release
```

The verified tarballs uploaded before Environment approval are the same files consumed by the side-effecting publish/stage job; release jobs do not rebuild after approval.

All third-party Actions in CI/release workflows are pinned to immutable commit SHAs.

## `0.1.0-rc.1` bootstrap publication — COMPLETE

`Bootstrap First npm Release #1` / Actions run `35174115348` completed successfully against source commit `e4758656c20f6cb90b05eb3429c79010667a2f7d`.

The workflow published all 15 supported `@axrail/*` packages under the `rc` dist-tag using `npm publish --provenance`, producing GitHub Actions provenance and Sigstore transparency-log entries. It intentionally did not create a Git tag or GitHub Release.

## Remaining external closeout

Issue #18 tracks the account-level steps that cannot be inferred solely from repository contents:

- revoke/delete the one-time bootstrap npm token and remove the `npm-release-bootstrap` `NPM_TOKEN` secret;
- configure each of the 15 npm packages with a GitHub Actions Trusted Publisher for `Kucell/axrail`, workflow `release-stage.yml`, Environment `npm-release`, stage-publish permission only;
- after Trusted Publishing is verified, require 2FA and disable traditional token publishing where supported;
- run `Finalize GitHub Release` with:

```text
version:     0.1.0-rc.1
commit_sha:  e4758656c20f6cb90b05eb3429c79010667a2f7d
confirm:     FINALIZE-RELEASE
```

- verify annotated tag `v0.1.0-rc.1` and the GitHub prerelease;
- close #18 only after the above closeout is complete.

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
