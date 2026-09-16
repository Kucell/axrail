# Axrail

**Transactional AI execution for industrial and engineering software.**

Axrail is open-source harness infrastructure for AI agents that safely understand, modify, validate, and execute engineering workflows. It is intentionally independent of any vendor or private HMI implementation.

## Execution model

```text
Intent → ChangeSet → Transaction → Policy → Validation → Approval → Commit
```

Each step turns an agent request into an explicit, reviewable artifact. Adapters connect engineering applications; policy and approval keep execution governed; validation determines whether a transaction may commit.

## Workspace

- `packages/`: runtime building blocks and adapter contracts
- `examples/`: small, vendor-neutral integration examples
- `docs/architecture/`: architecture notes
- `rfcs/`: evolving protocol proposals

## Quick start

```bash
corepack enable
pnpm install
pnpm check
pnpm test
```

## Status

This repository is in its bootstrap phase. Public APIs and protocol schemas are intentionally not yet stable.

## License

Apache-2.0. See [LICENSE](LICENSE).
