# Axrail Execution Boundary Semantics

This document records runtime semantics that are safety-relevant for v0.1 consumers.

## Observational events vs authoritative checkpoints

Ordinary Tool and Transaction lifecycle observers are **observational**. An observer failure must not change the truth of an engineering effect that already occurred.

Fail-closed durable audit is modeled separately through authoritative checkpoints:

- Tool `beforeExecute`
- Transaction `beforeApply`
- Transaction `beforeCommit`

A successful external commit remains `committed` even if a later lifecycle observer cannot persist telemetry.

## Tool timeout and effect uncertainty

Tool cancellation is cooperative. Axrail supplies an `AbortSignal`, and a timeout requests cancellation through a timeout-scoped `AbortController`, but an adapter or remote system may ignore or be unable to honor that signal.

For this reason:

- a timed-out read returns `timeout`;
- a timed-out Tool with any side-effecting effect returns `execution_uncertain`;
- `execution_uncertain` means Axrail cannot prove that no effect occurred;
- Tool error details include `effectUncertain` and `retrySafe`;
- callers and Agents must not treat `execution_uncertain` as an ordinary safe-to-retry failure unless idempotency and target-system semantics explicitly make retry safe.

A timeout does **not** imply rollback. Recovery or compensation belongs to the transaction/adapter boundary.

## Adapter Policy isolation

Adapter-owned Policy providers are Host-bound to their Adapter identity. They are evaluated only when `PolicyInput.adapterId` selects that Adapter. Provider IDs are namespaced by the Host to avoid collisions between different Adapters using the same local policy name.

Global application policies may still be registered directly on the Host PolicyEngine and apply across Adapter scopes.

For a Transaction with multiple `adapterIds`, the default Transaction Policy bridge evaluates every Adapter scope and combines the decisions conservatively:

- any deny → deny;
- otherwise any require-approval → require approval;
- otherwise allow;
- obligations are combined and enforced by the Transaction Runtime.

This keeps multi-Adapter governance consistent with provider-aware Tool and Validator resolution.

## Release consumer verification

The v0.1 package smoke gate validates both runtime and TypeScript consumers. It checks:

- direct dependency closure for emitted `.js` and `.d.ts` references;
- installation of all packed public packages into a clean npm project;
- runtime import of every public package root;
- TypeScript compilation with `module/moduleResolution: NodeNext`, `strict: true`, and `skipLibCheck: false`;
- packaged CLI execution.

These checks run on every supported Node major in CI.
