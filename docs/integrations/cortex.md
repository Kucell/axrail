# Cortex Connected-Project Integration

> Status: M-040 MS-009 pilot  
> Mode: `connected`

Axrail participates in the Cortex project-integration pilot as an **external autonomous project**.

The integration is intentionally not an embedded Cortex runtime and does not move Axrail governance/runtime ownership into Cortex.

## 1. Authority boundary

```text
Cortex
  Mission / Task / Cross-project coordination
  Architecture / Validation / Evidence / Release governance
  Decision / Waitpoint / Approval gates
          |
     Project Integration Contract
          |
        Axrail
  HarnessRuntime
  ToolRuntime
  Policy
  Validation
  Approval
  ChangeSet / TransactionRuntime
  EventStore
  Engineering Adapters
```

Axrail remains authoritative for engineering execution.

Cortex may coordinate software-development work around Axrail, but it must not bypass or replace Axrail's industrial execution boundary.

## 2. Descriptor

The repository root contains:

```text
cortex.project.json
```

It declares:

- stable project identity;
- repository identity;
- connected integration mode;
- project capabilities;
- validation profiles;
- architecture/release artifacts;
- observational event source;
- protected authority boundaries.

The descriptor is data. It is **not execution authorization**.

## 3. Validation profiles

The current pilot declares:

```text
typecheck       -> pnpm check
test            -> pnpm test
pack-smoke      -> pnpm pack:smoke
release-dry-run -> pnpm release:dry-run
```

Cortex may select one of these profiles through a governed Project Adapter.

Merely reading the descriptor must never execute the command.

Actual command execution requires:

1. an explicit Project Adapter operation owner;
2. applicable Cortex permission/policy checks;
3. normal Axrail repository/CI constraints;
4. evidence capture.

## 4. Events

The descriptor exposes `@axrail/events` as an observational source.

Cortex may project selected Axrail events into CortexEvent for Mission/evidence correlation.

Axrail events do not become Cortex commands, and Cortex events do not become Axrail transaction authority.

Example:

```text
transaction.committed
  -> observational project event
  -> CortexEvent
  -> evidence for a Mission milestone

transaction.committed
  != Cortex Mission completed
```

Mission completion remains subject to Cortex validation/evidence rules.

## 5. Protected components

The descriptor marks these Axrail components as project-authoritative:

- HarnessRuntime
- ToolRuntime
- Policy
- Validation
- Approval
- TransactionRuntime
- EventStore
- Engineering Adapters

A Cortex integration that attempts to replace or bypass those components is outside this contract.

## 6. What Cortex may govern

Cortex may govern:

- issue/task decomposition;
- architecture review;
- cross-repository Mission dependencies;
- validation profile selection;
- CI/test/package evidence;
- release readiness;
- merge/release gates;
- Decision/Waitpoint workflow;
- software-development Agent orchestration.

## 7. What Cortex may not own

Cortex does not own:

- Axrail Tool execution semantics;
- Axrail risk classification;
- Axrail Policy evaluation;
- Axrail Approval semantics;
- Axrail Validation pipeline;
- Axrail Transaction commit/rollback semantics;
- Axrail engineering Adapter behavior;
- physical/safety execution controls.

## 8. Pilot goal

This pilot demonstrates that Cortex can govern a project with a substantial independent runtime without requiring that project to become Cortex internals.

If this contract works for Axrail, the same model can be reused for HMI products, Industra, autopeer, robotics services, deployment systems, and other repositories.
