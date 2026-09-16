# @axrail/cli

A small read-only/diagnostic CLI foundation for Axrail v0.1.

From the repository root:

```bash
pnpm axrail --help
pnpm axrail --version
```

## Inspect a durable EventStore

```bash
pnpm axrail events inspect ./events.jsonl
pnpm axrail events inspect ./events.jsonl --session ses_123
pnpm axrail events inspect ./events.jsonl --correlation work-order-42
pnpm axrail events inspect ./events.jsonl --transaction tx_123 --limit 20
```

Output is JSON so it can be consumed by scripts and debugging tools.

## Calculate ChangeSet evidence digest

```bash
pnpm axrail changeset digest ./changeset.json
```

This uses the same canonical ChangeSet SHA-256 implementation used by Axrail approval evidence binding.

## Safety boundary

The v0.1 CLI intentionally has no deploy, physical-action, PLC-write, HMI-write, or other industrial side-effect command. Privileged engineering operations must continue through the Harness Tool/Policy/Approval/Transaction path rather than acquiring a CLI bypass.

The package exposes `runCli()` for embedding and deterministic tests. A distributable standalone binary can be added as part of release packaging/build hardening.
