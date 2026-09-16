# @axrail/hmi-adapter-kit

Vendor-neutral HMI domain contracts built **on top of** Axrail's generic Adapter SDK.

This package exists so HMI/SCADA integrations can share vocabulary and tool contracts without introducing HMI concepts into `@axrail/core` or `@axrail/harness`.

## Boundary

```text
@axrail/core / @axrail/harness
            ▲
            │ generic runtime contracts
            │
@axrail/adapter-sdk
            ▲
            │
@axrail/hmi-adapter-kit
            ▲
            │
Vendor / product adapters
```

The dependency must not point in the opposite direction.

## Standard capabilities

The initial vocabulary includes:

- `hmi.project.artifact`
- `hmi.project.inspect`
- `hmi.screen.create`
- `hmi.screen.update`
- `hmi.component.add`
- `hmi.component.update`
- `hmi.binding.create`
- `hmi.project.validate`
- `hmi.preview`
- `hmi.deploy`

Adapters can mark each capability as `exact`, `compatible`, `degraded`, or `unsupported` through `createHmiCapabilityManifest()`.

## Standard tool risk defaults

`createHmiTools()` provides reusable Tool definitions while leaving implementation to the adapter:

| Tool | Default risk | Effect |
| --- | --- | --- |
| project.inspect | L0 | read |
| screen.create/update | L2 | engineering-write |
| component.add/update | L2 | engineering-write |
| binding.create | L2 | engineering-write |
| project.validate | L0 | read |
| preview | L1 | local-write |
| deploy | L3 | deploy |

These are conservative domain defaults. An application may apply stronger Policy/Approval rules at runtime.

## Non-goals

This package does not define:

- a proprietary HMI project schema
- a specific component library
- PLC tag semantics for a particular vendor
- company-private AI-native configuration protocols
- runtime safety logic

Those remain adapter/product concerns.
