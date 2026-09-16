# @axrail/core

Minimal runtime kernel for Axrail.

## Responsibilities

`@axrail/core` owns vendor-neutral runtime infrastructure only:

- capability registration and resolution
- plugin lifecycle
- hierarchical scopes
- event dispatch
- runtime composition

It intentionally does not define HMI, PLC, robot, MES, or other domain-specific concepts.

## Example

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

Axrail currently recognizes four scope kinds:

```text
runtime
  ↓
workspace
  ↓
session
  ↓
transaction
```

A scope owns its local capability registry, event bus, and lifecycle disposers. Parent lookup semantics will be expanded as dependent packages are implemented.

## Status

This package is pre-release and tracks the evolving v0.1 RFCs, especially RFC-0004.
