# Hello Agent

A deterministic, vendor-neutral Axrail example that requires no API key and no industrial hardware.

Run from the repository root:

```bash
pnpm --filter @axrail/example-hello-agent start
```

The example demonstrates two Tool calls through `HarnessRuntime`:

```text
Agent
  ↓
demo.project.inspect   L0 / read
  ↓
demo.project.rename    L2 / engineering-write
  ↓
Policy requires approval
  ↓
ApprovalService
  ↓
Tool execution
```

The project is only an in-memory object. The example exists to show Axrail's runtime boundaries, not to model a particular HMI/PLC/robot vendor.

At the end it prints the final project state and the observable audit event types recorded by the Harness EventStore.
