# Changelog

All notable changes to Axrail will be documented in this file.

This project is pre-release. The repository and 15 supported public package manifests are currently prepared as `0.1.0-rc.1`, and the candidate artifacts have passed a no-publish dry run. No npm package or GitHub Release is implied by this changelog until an explicit release/tag action occurs.

## [Unreleased]

### Added

- Governed industrial Agent execution model across Tool, Policy, Approval, Validation, ChangeSet and Transaction runtimes.
- Immutable Tool invocation evidence shared by Policy, Approval, Audit and execution.
- ChangeSet canonical SHA-256 evidence digests and approval freshness checks.
- Provider-aware semantic Tool routing for multiple Adapters.
- Approval quorum enforcement and conservative L4/L5 governance floors.
- Explicit audit failure profiles: `best_effort`, `required_before_effect`, and `required_before_commit`.
- In-memory and append-only JSONL EventStore implementations with Session/correlation replay support.
- Official MCP TypeScript SDK integration behind Axrail Tool governance.
- OpenAI-compatible Responses model provider.
- Vendor-neutral HMI Adapter Kit and HMI reference flow.
- Read-only diagnostic CLI for EventStore inspection and ChangeSet digest calculation.
- Provider-aware Validator scoping and explicit scoped Adapter context retrieval.
- Node 20 / 22 / 24 CI matrix with frozen pnpm lockfile verification.
- TypeScript project-reference build graph producing NodeNext ESM JavaScript and declaration files for the 15 supported public packages.
- Clean-consumer tarball install/import smoke testing for every public package and the packaged CLI.
- Manual `Release Candidate Dry Run` workflow that retains verified package tarballs as GitHub Actions artifacts without publishing them.

### Changed

- `@axrail/harness` + `AdapterHost` are the supported v0.1 runtime composition model; `@axrail/core` is explicitly experimental/internal and excluded from the supported public package set.
- The 15 supported public packages now use lockstep `0.1.0-rc.1` manifests and built `dist` entry points.
- Agent same-turn Tool calls remain sequential and stop the remaining Tool batch after the first failure by default, allowing the model to replan. `toolFailureMode: "continue"` is an explicit opt-in.
- Adapter unmount drains local provider surfaces before external Adapter shutdown begins.
- AbortSignal transaction cancellation now emits the normal `transaction.cancelled` transition/event.
- MCP same-name Tool descriptor changes now trigger re-registration and risk re-classification.

### Security

- Privileged Tool execution remains fail-closed when required Policy or Approval providers are unavailable.
- Unsupported Policy obligations fail closed.
- Approval decisions are bound to immutable execution evidence digests.
- Trusted MCP read-only hints cannot remain stale after descriptor changes.
- Sensitive Adapter context fragments are excluded from explicit context retrieval unless the caller opts in.

### Release preparation

- v0.1 public package/API surface approved and documented in `docs/release/v0.1-public-api.md`.
- TypeScript project-reference build strategy approved and implemented.
- Lockstep v0.1 versioning/release policy approved and documented in `docs/release/v0.1-versioning-release-policy.md`.
- `0.1.0-rc.1` no-publish dry run passed on Node 20, 22 and 24 with 65 behavioral tests and 15 clean-installed package tarballs.
- Apache-2.0 license text is carried with each supported public package artifact.
- Real registry publication, release tags, GitHub Releases, credentials and provenance automation remain separate explicit release actions.

[Unreleased]: https://github.com/Kucell/axrail/compare/main...HEAD
