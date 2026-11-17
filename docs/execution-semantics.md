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

## Transaction failure after a possible external effect (beta opt-in)

`TransactionRuntimeOptions.effectFailureMode: "uncertain"` (also available through
the Harness transaction and high-level ChangeSet execution options) is an
**opt-in conservative classification**. The current default remains
`"legacy"` for compatibility with existing v0.2-alpha consumers.

In conservative mode, errors or missing acknowledgements during
`executor.apply`, `executor.verify`, or `executor.commit` produce
`state: "execution_uncertain"` and `error.code: "execution_uncertain"`.
This means the remote system *may already have applied the change*; neither
success nor rollback can be inferred. Axrail does **not** automatically retry
the effect. The domain Adapter must use authoritative read-back, idempotency
evidence and explicit recovery/compensation rules before another attempt.

An exception thrown by `apply` cannot distinguish "never sent" from "sent,
effect completed, ACK lost" without extra Adapter evidence. `verify` returning
false likewise does not generally prove that a remote effect was absent.
The opt-in mode therefore treats these as unresolved, even if later inquiry
might prove a definitive failure.

The mode is intentionally not a replacement for persistent job/attempt
journaling, unique idempotency keys, outbox protocols, live device verification,
or safety-rated control. Do not mark `execution_uncertain` as successfully
committed or automatically roll it back. The `legacy` mode retains existing
`execution_failed`, `verification_failed`, and `commit_failed` semantics
until separately reviewed for a broader compatibility change.

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
