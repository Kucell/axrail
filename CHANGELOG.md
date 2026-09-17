# Changelog

All notable changes to Axrail will be documented in this file.

Axrail is currently in pre-release. The 15 supported public packages have been published to npm as `0.1.0-rc.1` under the `rc` dist-tag with GitHub Actions provenance. The corresponding Git tag and GitHub prerelease have not yet been finalized.

## [Unreleased]

### Added

- Governed industrial Agent execution model across Tool, Policy, Approval, Validation, ChangeSet and Transaction runtimes.
- Immutable Tool invocation evidence shared by Policy, Approval, Audit and execution.
- ChangeSet canonical SHA-256 evidence digests and approval freshness checks.
- Provider-aware semantic Tool routing for multiple Adapters.
- Host-scoped and namespaced Adapter Policy providers plus multi-Adapter Transaction policy aggregation.
- Approval quorum enforcement and conservative L4/L5 governance floors.
- Explicit audit failure profiles: `best_effort`, `required_before_effect`, and `required_before_commit`.
- In-memory and append-only JSONL EventStore implementations with Session/correlation replay support.
- Official MCP TypeScript SDK integration behind Axrail Tool governance.
- OpenAI-compatible Responses model provider.
- Vendor-neutral HMI Adapter Kit and HMI reference flow.
- Read-only diagnostic CLI for EventStore inspection and ChangeSet digest calculation.
- Provider-aware Validator scoping and explicit scoped Adapter context retrieval.
- Timeout-scoped cooperative Tool cancellation with explicit `timeout` / `execution_uncertain` semantics.
- Postcondition/result-validation uncertainty semantics for side-effecting Tools.
- Agent lifecycle observer isolation with explicit propagation mode for authoritative consumers.
- Node 20 / 22 / 24 CI matrix with frozen pnpm lockfile verification.
- TypeScript project-reference build graph producing NodeNext ESM JavaScript and declaration files for the 15 supported public packages.
- Clean-consumer runtime and strict TypeScript declaration smoke testing for every public package plus Adapter SDK advanced subpaths.
- Emitted `.js` / `.d.ts` package dependency-closure audit.
- Manual no-publish RC dry-run workflow retaining verified package tarballs as GitHub Actions artifacts.
- One-time protected npm bootstrap workflow for first-ever package publication.
- Long-term GitHub OIDC Trusted Publishing workflow using npm staged publishing.
- Protected GitHub Release finalizer that verifies all 15 npm package versions before creating the release tag.
- Release workflow contract tests for Environment guards, OIDC/token boundaries, immutable Action pins and registry-before-tag ordering.
- Prepared `0.1.0-rc.1` GitHub Release notes and npm publication runbook.

### Changed

- `@axrail/harness` + `AdapterHost` are the supported v0.1 runtime composition model; `@axrail/core` is explicitly experimental/internal and excluded from the supported public package set.
- The 15 supported public packages use lockstep `0.1.0-rc.1` manifests and built `dist` entry points.
- v0.1 is explicitly Node >=20 and ESM-only.
- Agent same-turn Tool calls remain sequential and stop the remaining Tool batch after the first failure by default, allowing the model to replan. `toolFailureMode: "continue"` is an explicit opt-in.
- Adapter unmount drains local provider surfaces before external Adapter shutdown begins.
- AbortSignal transaction cancellation emits the normal `transaction.cancelled` transition/event.
- Transaction lifecycle observers are observational and cannot relabel an already committed effect.
- MCP same-name Tool descriptor changes trigger re-registration and risk re-classification.
- Adapter SDK advanced Host/Registry/ContextRegistry APIs have explicit experimental subpath exports.
- v0.1 build artifacts omit source/declaration maps because package source files are not shipped.
- CI and release workflows pin third-party GitHub Actions to immutable commit SHAs.
- `JsonlEventStore` is explicitly positioned as embedded/reference storage, not a production audit-database guarantee.
- Production guidance recommends explicit strict audit profiles when durable pre-effect/pre-commit evidence is required.

### Security

- Privileged Tool execution remains fail-closed when required Policy or Approval providers are unavailable.
- Unsupported Policy obligations fail closed.
- Approval decisions are bound to immutable execution evidence digests.
- Trusted MCP read-only hints cannot remain stale after descriptor changes.
- Sensitive Adapter context fragments are excluded from explicit context retrieval unless the caller opts in.
- Side-effecting timeout/postcondition failures are represented as effect uncertainty rather than safe retryable execution failures.
- Publication side-effect jobs require protected GitHub Environments plus `RELEASE_GUARD=enabled`.
- Subsequent npm releases are designed for OIDC Trusted Publishing with no long-lived npm write token.
- GitHub Release finalization verifies npm registry visibility before tag creation.

### Release preparation

- v0.1 public package/API surface approved and documented in `docs/release/v0.1-public-api.md`.
- TypeScript project-reference build strategy approved and implemented.
- Lockstep v0.1 versioning/release policy approved and documented in `docs/release/v0.1-versioning-release-policy.md`.
- Final architecture Gate #21 passed focused re-review; post-RC hardening #22 is closed.
- CI #222 passed Node 20, 22 and 24 with **73/73 behavioral tests**, dependency closure, 15 package tarballs, runtime imports, strict TypeScript consumer compilation, advanced Adapter SDK subpaths and packaged CLI verification.
- CI #239 revalidated the final RC1 source/docs baseline before bootstrap publication.
- Apache-2.0 license text is carried with each supported public package artifact.
- Repository-side bootstrap, staged Trusted Publishing and GitHub Release-finalization workflows are implemented.

### `0.1.0-rc.1` npm publication

- Bootstrap First npm Release #1 / Actions run `35174115348` completed successfully.
- Source/provenance commit: `e4758656c20f6cb90b05eb3429c79010667a2f7d`.
- Exact publish artifact digest: `sha256:258ea4d791af0fcff46d642b9fb1e97eea7e315c6355aff1a2b170d183a96d1b`.
- All 15 public `@axrail/*` packages were published as `0.1.0-rc.1` with npm dist-tag `rc`.
- Publishing used `--provenance`; signed GitHub Actions provenance statements were added to the Sigstore transparency log.
- The bootstrap workflow did **not** create a Git tag or GitHub Release.
- Remaining closeout: revoke the bootstrap token, configure stage-only Trusted Publishers for all 15 packages, and finalize `v0.1.0-rc.1` as a GitHub prerelease from the exact published source commit.

[Unreleased]: https://github.com/Kucell/axrail/compare/main...HEAD
