# @axrail/harness

High-level Axrail composition root.

`@axrail/harness` wires the vendor-neutral runtime surfaces together without moving domain concepts into `@axrail/core`.

It is intended to own or share:

- `AdapterHost`
- `ToolRuntime`
- `PolicyEngine`
- `ValidationPipeline`
- `ArtifactProviderRegistry`
- `EventStore` / `SessionService`
- approval integration
- agent creation

Individual Axrail packages remain independently usable. HMI, PLC, robot, MES and other domain concepts continue to live behind adapters.
