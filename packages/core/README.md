# @axrail/core

Experimental capability/plugin kernel research for Axrail.

> **v0.1 public-surface note:** `@axrail/core` is not currently intended to be part of the first supported public package set. The actual v0.1 product composition path is `@axrail/harness` + `@axrail/adapter-sdk` + the protocol/runtime primitive packages. This package remains in the monorepo while RFC-0004 capability/plugin semantics are evaluated against the working Harness architecture.

## Responsibilities under evaluation

`@axrail/core` explores vendor-neutral runtime infrastructure such as:

- capability registration and resolution;
- plugin lifecycle;
- hierarchical scopes;
- event dispatch;
- generic runtime composition.

It intentionally does not define HMI, PLC, robot, MES, or other domain-specific concepts.

## Why it is experimental

The current production-shaped runtime has evolved around:

```text
@axrail/harness
    ↓
AdapterHost
    ↓
Tools / Artifacts / Policy / Approval / Validation / Transactions / Events
```

RFC-0004 instead describes a more general capability/plugin kernel. The two models have not yet been fully converged. In particular, current `@axrail/core` does not yet implement every RFC-0004 behavior such as full capability-version compatibility, parent-scope provider inheritance, and capability-based plugin dependency resolution.

Until that convergence decision is made, applications and adapters should not depend on `@axrail/core` as a stable public runtime contract.

## Experimental example

```ts
import {
  createRuntime,
  type AxrailPlugin,
  type Capability,
} from "@axrail/core";

interface Clock {
  now(): string;
}

const clock: Capability<Clock> = {
  id: "example.clock",
  version: "1.0.0",
};

const clockPlugin: AxrailPlugin = {
  id: "example.clock-plugin",
  version: "0.1.0",
  setup({ scope }) {
    return scope.capabilities.register({
      capability: clock,
      providerId: "example.clock-plugin",
      value: {
        now: () => new Date().toISOString(),
      },
    });
  },
};

const runtime = createRuntime();
await runtime.use(clockPlugin);

const provider = runtime.scope.capabilities.resolve(clock);
console.log(provider.now());

await runtime.dispose();
```

## Scope model

The experimental kernel currently recognizes four scope kinds:

```text
runtime
  ↓
workspace
  ↓
session
  ↓
transaction
```

A scope owns its local capability registry, event bus, and lifecycle disposers. Parent lookup semantics remain incomplete relative to RFC-0004.

## Status

Experimental/internal for the v0.1 public API review. Track the convergence work under the architecture P2 follow-up issue.
