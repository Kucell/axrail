# Axrail HMI Agent Example

This example demonstrates Axrail's complete governed execution path without using a proprietary HMI product or a real model API.

```text
Deterministic demo model
        ↓
AgentLoop
        ↓
ToolRuntime
        ↓
hmi.screen.create
        ↓
ChangeSet
        ↓
TransactionRuntime
        ├─ PolicyEngine
        ├─ ValidationPipeline
        └─ ApprovalService
        ↓
Mock HMI atomic executor
        ↓
Commit
```

The example deliberately separates the generic Axrail runtime from HMI-domain behavior. A production HMI integration would replace `mock-hmi` with its own adapter, artifact provider, validators, policies, and transaction executor.

No company-private HMI code or schema is used here.
