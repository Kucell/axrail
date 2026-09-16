# Embedding Axrail with HarnessRuntime

`@axrail/harness` is the high-level composition root for applications that do not want to manually wire every runtime package.

```ts
import { HarnessRuntime } from "@axrail/harness"

const harness = new HarnessRuntime({
  environment: "design",
  approval: myApprovalService,
})

await harness.mountAdapter(myEngineeringAdapter)

const agent = harness.createAgent({
  model: myModelProvider,
  systemPrompt: "Use governed engineering tools.",
})

const result = await agent.run("Create a robot overview", {
  actorId: "engineer-1",
  metadata: {
    correlationId: "work-order-123",
  },
})
```

## What the Harness owns

By default the runtime composes:

- AdapterHost
- ToolRuntime
- PolicyEngine through AdapterHost
- ArtifactProviderRegistry through AdapterHost
- ValidationPipeline through AdapterHost
- ApprovalService when provided
- EventStore (in-memory reference provider by default)
- SessionService
- session-backed AgentLoop creation
- governed TransactionRuntime factory

## Audit flow

When a correlation ID is supplied, observable events can be replayed across the complete execution path:

```text
session.created
agent.step.started
policy.evaluation.completed
approval.requested
approval.approved
tool.execution.started
transaction.preparing
transaction.validated
transaction.applying
transaction.committed
tool.execution.succeeded
agent.completed
session.completed
```

The exact event set depends on policy, approval, validation, and transaction behavior.

## Domain boundary

HarnessRuntime does not know HMI screens, PLC tags, robot programs, or MES workflows. Those concepts remain inside adapters and domain packages.

The company/private AI-native HMI integration should therefore live outside this repository as its own Adapter/Plugin package and consume the public Axrail contracts.
