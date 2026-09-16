# Changelog

All notable changes to Axrail will be documented in this file.

This project is pre-release. The current development line targets the first `0.1.0` release. Package/API and build decisions are still being finalized; entries under **Unreleased** describe implemented repository state, not a published package guarantee.

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

### Changed

- `@axrail/harness` + `AdapterHost` are the supported v0.1 runtime composition direction; `@axrail/core` is explicitly experimental/internal for the first public release proposal.
- Agent same-turn Tool calls remain sequential and now stop the remaining Tool batch after the first failure by default, allowing the model to replan. `toolFailureMode: "continue"` is an explicit opt-in.
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

- v0.1 public package/API surface proposal documented in `docs/release/v0.1-public-api.md`.
- v0.1 release readiness documented in `docs/release/v0.1-readiness.md`.
- versioning/release policy draft documented in `docs/release/v0.1-versioning-release-policy.md`.

[Unreleased]: https://github.com/Kucell/axrail/compare/main...HEAD
