# Axrail Architecture and Design

> **Transactional AI execution for industrial and engineering software.**

Axrail is an open-source harness runtime for AI agents that operate industrial and engineering software. It is designed to let models understand engineering context, propose changes, validate those changes, obtain the required approvals, and commit them through controlled, auditable transactions.

Axrail is intentionally independent of any single HMI, SCADA, PLC, robotics, MES, CAD/CAE, or digital-twin product. Product-specific behavior belongs in adapters and plugins, not in the kernel.

## 1. Project positioning

Axrail is not an HMI product, a PLC IDE, an MCP server, or a generic chat-agent framework. It is an execution and governance layer between AI agents and engineering software.

```text
                AI Models / Agents
        GPT / DeepSeek / Claude / Local
                         │
                         ▼
                ┌────────────────┐
                │     Axrail     │
                │ Industrial AI  │
                │    Harness     │
                └───────┬────────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
   HMI / SCADA         PLC             Robot
       │                │                │
       ▼                ▼                ▼
      MES            CAD / CAE      Digital Twin
```

Axrail's role is to turn unconstrained agent intent into governed engineering execution.

## 2. Core execution model

The fundamental Axrail execution model is:

```text
Intent
  ↓
ChangeSet
  ↓
Transaction
  ↓
Policy
  ↓
Validation
  ↓
Approval
  ↓
Commit
```

A model should not jump directly from an intent to a privileged side effect. Important engineering changes should first become explicit, reviewable data and then pass through a controlled execution pipeline.

### Intent

What the user or agent wants to achieve.

Examples:

- Create a robot monitoring page.
- Change an HMI control binding.
- Update a PLC configuration.
- Modify a robot program.
- Deploy an engineering project.

### ChangeSet

A structured proposal describing what should change and why.

A ChangeSet is portable data. It should be inspectable, diffable, versionable, auditable, and suitable for preview before execution.

```yaml
kind: ChangeSet
artifact:
  ref: hmi://factory-a/main-project
operations:
  - op: create
    target: screen
    value:
      name: Robot Overview
reason: Create a robot monitoring screen
```

### Transaction

An isolated execution boundary for applying a ChangeSet.

```text
begin
  ↓
apply
  ↓
validate
  ↓
preview
  ↓
approve
  ↓
commit
```

On failure:

```text
rollback
```

Transactions make multi-step engineering changes safer than direct tool execution.

### Policy

Policy determines **whether an operation is allowed** and under what conditions.

Examples:

- Read-only operations may run automatically.
- Engineering modifications may require an engineer role.
- Production deployment may require explicit approval.
- Live PLC writes may be blocked in design mode.

### Validation

Validation determines **whether a proposed or executed change is technically correct**.

This is distinct from policy:

```text
Policy     → Are we allowed to do this?
Validation → Is this change valid?
```

For example, a user may be authorized to create an alarm, while validation can still reject the alarm because its tag binding does not exist.

### Approval

Approval is the human or machine authorization step for operations whose risk requires explicit consent.

Axrail should be fail-closed for privileged operations when required approval is unavailable.

### Commit

Commit makes the validated and approved transaction durable in the target engineering system.

## 3. First-class domain concepts

Axrail treats the following concepts as first-class runtime primitives.

### Artifact

An Artifact is an engineering asset being understood or modified by an agent.

Examples:

- HMI project
- PLC project
- Robot program
- MES workflow
- Recipe
- CAD model
- Engineering configuration
- Automation script

```yaml
kind: Artifact
id: hmi://factory-a/main-project
type: industrial.hmi.project
version: 18
provider: vendor-adapter
```

The Axrail kernel does not need to understand the internal semantics of every artifact type. Domain adapters expose the required capabilities.

### ChangeSet

Represents proposed changes to one or more artifacts.

### Transaction

Coordinates the safe lifecycle of those changes.

### Capability

A stable contract for functionality offered by a provider or plugin.

Examples:

- tools
- artifacts
- transactions
- policies
- validators
- approvals
- context providers
- model providers
- adapters

### Tool

A callable capability exposed to an agent through the Axrail Tool Runtime.

### Event

An append-only record of meaningful runtime activity such as a tool request, policy decision, validation result, approval, rollback, or commit.

## 4. System architecture

```text
                 AI / Human
                     │
                     ▼
             ┌───────────────┐
             │ Agent Runtime │
             └───────┬───────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     Context       Session       Skills
        │            │            │
        └────────────┼────────────┘
                     ▼
             ┌───────────────┐
             │ Tool Runtime  │
             └───────┬───────┘
                     │
            ChangeSet / Artifact
                     │
                     ▼
             ┌───────────────┐
             │ Transaction   │
             └───────┬───────┘
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
     Policy       Validation     Approval
       │             │             │
       └─────────────┼─────────────┘
                     ▼
                 Commit
                     │
                     ▼
              Adapter Boundary
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
      HMI            PLC          Robot
```

## 5. Kernel boundary

The Axrail kernel should remain deliberately small.

The kernel owns infrastructure concepts such as:

- capability registration
- plugin loading
- dependency resolution
- lifecycle
- scopes
- event dispatch
- service lookup

The kernel should **not** hard-code HMI or automation product concepts such as:

- Screen
- Widget
- Tag
- Alarm
- Trend
- Recipe
- Faceplate

Those belong in adapters, plugins, or domain packages.

This keeps Axrail reusable across HMI, PLC, robotics, MES, digital twins, CAD/CAE, and other engineering environments.

## 6. Package architecture

The initial package model is:

```text
packages/
├── core
├── agent
├── tools
├── artifacts
├── changesets
├── transactions
├── policy
├── approval
├── validation
├── mcp
└── adapter-sdk
```

### `@axrail/core`

Kernel capabilities, plugin lifecycle, scopes, events, and dependency registration.

### `@axrail/agent`

Agent loop and model-facing runtime orchestration.

### `@axrail/tools`

Tool definitions, registry, execution pipeline, tool result model, and risk metadata.

### `@axrail/artifacts`

Portable engineering artifact contracts and artifact provider interfaces.

### `@axrail/changesets`

Structured engineering change proposals and operations.

### `@axrail/transactions`

Transaction lifecycle, staged execution, commit, rollback, and transaction state.

### `@axrail/policy`

Authorization, execution rules, risk constraints, and runtime policy evaluation.

### `@axrail/approval`

Human/system approval contracts and approval lifecycle.

### `@axrail/validation`

Composable semantic, structural, domain, adapter, and safety validators.

### `@axrail/mcp`

MCP interoperability and bridging into Axrail-native capabilities.

### `@axrail/adapter-sdk`

Contracts for connecting engineering software without coupling it to Axrail internals.

## 7. Tool execution pipeline

Tools are not executed directly by the model.

The intended pipeline is:

```text
Tool Call
   ↓
Resolve Tool
   ↓
Validate Input Schema
   ↓
Build Execution Context
   ↓
Classify Risk
   ↓
Evaluate Policy
   ↓
Check Permission
   ↓
Request Approval (when required)
   ↓
Sandbox / Transaction Boundary
   ↓
Execute
   ↓
Validate Result
   ↓
Emit Audit Events
```

This is one of the main distinctions between Axrail and general-purpose tool-calling frameworks.

## 8. Risk model

Axrail should ship with a vendor-neutral default risk classification that applications can extend.

| Level | Meaning | Examples |
| --- | --- | --- |
| L0 | Read only | Query tags, inspect project, read metadata |
| L1 | Local modification | Move a UI component, modify local draft data |
| L2 | Engineering modification | Change bindings, scripts, PLC/HMI engineering configuration |
| L3 | Deployment | Deploy or overwrite an engineering runtime/project |
| L4 | Physical action | Start motor, change live machine state, issue runtime command |
| L5 | Safety critical | Safety PLC changes or safety-related machine actions |

Risk level alone does not determine safety. Adapters and deployment environments can apply stronger policies.

## 9. Adapter architecture

Adapters connect Axrail to external engineering applications.

A generic adapter can expose:

```ts
interface AxrailAdapter {
  id: string

  capabilities(): Promise<CapabilityManifest>
  tools(): ToolProvider[]
  artifacts?(): ArtifactProvider
  context?(): ContextProvider[]
  validators?(): Validator[]
  policies?(): PolicyProvider[]
}
```

Adapters may represent:

- AI-native HMI software
- WinCC or other HMI/SCADA products
- PLC engineering systems
- OPC UA systems
- robot programming tools
- MES platforms
- digital-twin environments
- CAD/CAE systems

The kernel remains independent from vendor schemas.

## 10. HMI as the first reference domain

HMI configuration is the first major reference domain for Axrail, but Axrail must not become an HMI-specific kernel.

An HMI integration can register tools such as:

```text
hmi.project.inspect
hmi.screen.create
hmi.component.add
hmi.component.update
hmi.binding.create
hmi.alarm.create
hmi.project.validate
hmi.preview
hmi.deploy
```

Those tools are provided by the HMI adapter. Axrail itself only sees their schemas, policies, risk metadata, artifact relationships, and execution lifecycle.

### Relationship to the existing company AI-native HMI product

The company AI-native HMI product and Axrail are separate projects.

```text
Open-source project
────────────────────────────────
Axrail
   │
   │ Adapter / Plugin SDK
   ▼
Integration boundary
────────────────────────────────
   │
   ▼
Company commercial product
────────────────────────────────
AI-native HMI
   ├── HMI Adapter
   ├── HMI Tools
   ├── HMI Skills
   ├── HMI Validators
   └── HMI Context Providers
```

Axrail should contain no proprietary HMI source code, proprietary component implementation, private schema, or product-specific dependency.

The commercial HMI can be a first-class adopter of Axrail without making Axrail dependent on it.

## 11. MCP relationship

MCP is an integration protocol, not the Axrail core domain model.

```text
LLM / Agent
    │
    ▼
  Axrail
    │
    ▼
MCP Bridge
    │
 ┌──┼──────────────┐
 ▼  ▼              ▼
OPC MES          HMI MCP
UA  MCP          Server
```

External MCP tools should be normalized into Axrail's controlled tool runtime so that they still pass through policy, approval, transaction boundaries, validation, and auditing.

Axrail should avoid this pattern for privileged engineering operations:

```text
LLM → MCP → live industrial action
```

The preferred pattern is:

```text
LLM
 ↓
Axrail Tool Runtime
 ↓
Policy / Approval / Transaction / Validation
 ↓
MCP / Adapter
 ↓
Engineering System
```

## 12. Plugin and capability model

Axrail borrows the useful principle that runtime features should be replaceable and composable, but adapts it for industrial execution.

The preferred rule is:

> Everything extends a capability.

Potential plugin types include:

- model plugin
- tool plugin
- skill plugin
- adapter plugin
- validator plugin
- policy plugin
- approval plugin
- storage plugin
- sandbox plugin
- MCP plugin

Consumers should depend on capability contracts instead of concrete providers.

## 13. Session and event model

Axrail should use an append-only event model for agent and transaction history.

Potential events include:

```text
session.created
intent.received
artifact.opened
changeset.proposed
transaction.started
tool.requested
policy.evaluated
approval.requested
approval.granted
validation.failed
validation.passed
transaction.committed
transaction.rolled_back
```

The event log provides a basis for:

- auditability
- replay
- debugging
- history reconstruction
- observability
- version tracking
- future branching/merging workflows

## 14. Configuration and engineering workflows

Axrail should favor patch/change-based modification rather than full regeneration.

Instead of having a model regenerate an entire engineering project, the model should produce focused ChangeSets.

For example:

```json
{
  "operations": [
    {
      "op": "move",
      "target": "component:robot-status",
      "region": "left"
    },
    {
      "op": "add",
      "target": "screen:overview",
      "value": {
        "type": "alarm.list",
        "limit": 20
      }
    }
  ]
}
```

This makes agent behavior easier to review, validate, revert, and audit.

## 15. Native systems and compatibility systems

When Axrail is used with a modern AI-native engineering environment, the integration may support the complete transaction and semantic model.

Legacy or third-party software may support only a subset of Axrail capabilities.

Adapters should therefore be able to describe capability support such as:

```text
Exact
Compatible
Degraded
Unsupported
```

This allows an agent to reason about the target platform before proposing a change.

## 16. Design principles

### Model agnostic

Axrail should work with cloud and local models without making one model provider part of the core architecture.

### Vendor agnostic

Engineering-system support belongs behind adapters.

### Transaction first

Important mutations should be previewable, validatable, committable, and rollback-capable.

### Human governed

High-risk actions should support explicit human approval.

### Observable

Policy decisions, approvals, validations, tool execution, and commits should be represented as structured events.

### MCP compatible, not MCP dependent

MCP should be easy to integrate without becoming Axrail's internal object model.

### Safety boundaries before autonomy

AI autonomy must not bypass deterministic engineering and runtime safety controls.

### Portable domain data

Artifacts, ChangeSets, tool contracts, events, and policy inputs should remain portable wherever possible.

## 17. v0.1 scope

Axrail v0.1 should remain focused on the execution foundation.

### Included

1. Kernel and capability runtime
2. Plugin lifecycle
3. Agent loop
4. Tool runtime
5. Artifact model
6. ChangeSet protocol
7. Transaction runtime
8. Policy engine
9. Approval contracts
10. Validation pipeline
11. MCP bridge
12. Adapter SDK
13. CLI foundation
14. Vendor-neutral examples

### Deliberately deferred

- complex multi-agent orchestration
- long-term memory platform
- vector database infrastructure
- full GUI studio
- cloud control plane
- HMI runtime implementation
- PLC IDE implementation
- marketplace

The goal of v0.1 is to prove the runtime model rather than maximize feature count.

## 18. Initial roadmap

### v0.1 — Harness Foundation

```text
Kernel
Tools
Artifact
ChangeSet
Transaction
Policy
Validation
Approval
MCP
Adapter SDK
```

### v0.2 — Engineering Runtime

```text
Skills
Context Providers
Sandbox
Advanced Adapter SDK
Event Store
```

### v0.3 — Industrial Connectivity

```text
OPC UA
MQTT
HMI adapter examples
Robot adapter examples
```

### v0.4 — Multi-Agent

```text
Supervisor
Workers
Task graph
Artifact locking
```

### v0.5 — Ecosystem

```text
Plugin registry
Adapter registry
Skill registry
```

### v1.0

Freeze the first stable public protocol and SDK contracts.

## 19. Initial RFC sequence

The first architecture work should concentrate on a small set of durable contracts:

1. RFC-0001 — Artifact Model
2. RFC-0002 — ChangeSet Protocol
3. RFC-0003 — Transaction Runtime
4. RFC-0004 — Capability and Plugin Model
5. RFC-0005 — Tool Runtime and Risk Model
6. RFC-0006 — Adapter Protocol
7. RFC-0007 — Policy and Approval Model
8. RFC-0008 — Event and Session Model

These should evolve before Axrail attempts broad vendor integration.

## 20. Long-term direction

The long-term goal is not only an Axrail runtime implementation but a reusable protocol and ecosystem for industrial AI execution.

A mature ecosystem could support statements such as:

```text
This engineering tool supports Axrail.
This HMI exposes an Axrail adapter.
This robot platform exports Axrail capabilities.
This operation returns an Axrail ChangeSet.
```

The durable value of Axrail should be the common execution language between AI agents and engineering systems: explicit artifacts, structured changes, transactional execution, policy, approval, validation, and auditable commit.
