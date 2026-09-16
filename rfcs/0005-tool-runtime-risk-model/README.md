# RFC 0005: Tool Runtime & Risk Model

Status: Draft

Defines the Axrail tool contract, execution pipeline, risk classification, policy hooks, approval requirements, transaction integration, result validation, and audit behavior.

## 1. Motivation

General-purpose agent systems often model execution as:

```text
Model → Tool → Result
```

Industrial and engineering systems need a stronger execution boundary because tools may mutate engineering projects, deploy software, or affect physical equipment.

Axrail therefore treats tool execution as a governed pipeline rather than a direct function call.

## 2. Goals

This RFC defines:

- tool identity and metadata
- tool input/output contracts
- execution context
- deterministic execution pipeline
- risk classification
- policy evaluation hooks
- approval hooks
- transaction participation
- validation hooks
- cancellation and timeouts
- idempotency metadata
- audit events
- error taxonomy

## 3. Tool Contract

```ts
export interface AxrailTool<I = unknown, O = unknown> {
  id: string
  version: string
  description: string

  inputSchema: JsonSchema
  outputSchema?: JsonSchema

  risk: ToolRiskDescriptor
  effects: ToolEffectDescriptor

  execute(ctx: ToolExecutionContext, input: I): Promise<O>
}
```

Tool IDs SHOULD be namespaced.

Examples:

```text
hmi.project.inspect
hmi.screen.create
plc.project.validate
plc.runtime.deploy
robot.program.simulate
robot.runtime.start
mcp__mes__get_order
```

## 4. Tool Metadata

A tool SHOULD declare enough metadata for Axrail to reason about side effects before execution.

```ts
export interface ToolEffectDescriptor {
  mutatesArtifacts?: boolean
  externalSideEffects?: boolean
  physicalSideEffects?: boolean
  reversible?: boolean
  requiresTransaction?: boolean
  idempotent?: boolean
}
```

Example:

```yaml
id: hmi.component.add
risk:
  level: L2
effects:
  mutatesArtifacts: true
  externalSideEffects: false
  physicalSideEffects: false
  reversible: true
  requiresTransaction: true
  idempotent: false
```

## 5. Risk Classification

Axrail defines a default six-level risk model.

| Level | Name | Typical examples |
| --- | --- | --- |
| L0 | Read Only | inspect project, query tag metadata, read diagnostics |
| L1 | Local Modification | change draft layout, edit local metadata |
| L2 | Engineering Modification | modify bindings, scripts, PLC/HMI configuration |
| L3 | Deployment | publish or deploy engineering changes |
| L4 | Physical Action | issue live machine commands or runtime state changes |
| L5 | Safety Critical | safety PLC changes or safety-related actions |

The level is a baseline classification, not a complete authorization decision.

Environment and adapter policy MAY elevate risk.

For example:

```text
hmi.deploy to simulator  → L2/L3
hmi.deploy to production → L3
plc.write to test bench  → L3/L4
plc.write to live line   → L4
```

## 6. Risk Descriptor

```ts
export interface ToolRiskDescriptor {
  level: "L0" | "L1" | "L2" | "L3" | "L4" | "L5"
  category?: string[]
  rationale?: string
  dynamic?: boolean
}
```

If `dynamic` is true, runtime context may change the final classification.

```ts
finalRisk = classify(tool.risk, input, context)
```

Risk classification SHOULD happen before policy and approval evaluation.

## 7. Execution Pipeline

The standard Axrail tool pipeline is:

```text
Tool Call
   ↓
1. Resolve
   ↓
2. Validate Input
   ↓
3. Build Execution Context
   ↓
4. Classify Risk
   ↓
5. Evaluate Policy
   ↓
6. Check Preconditions
   ↓
7. Require Approval (if needed)
   ↓
8. Join / Begin Transaction
   ↓
9. Execute
   ↓
10. Validate Output / Effects
   ↓
11. Record Result
   ↓
12. Emit Audit Events
```

No privileged tool SHOULD bypass this pipeline.

## 8. Resolve

Resolution determines the exact tool implementation and version.

The runtime MUST reject:

- unknown tool IDs
- ambiguous providers
- incompatible tool versions
- tools unavailable in the active scope

The resolved provider SHOULD be included in audit metadata.

## 9. Input Validation

Input MUST be validated before policy evaluation when possible.

This prevents malformed data from reaching policy engines or adapters.

Validation errors SHOULD be structured:

```ts
interface ToolInputError {
  code: "tool_input_invalid"
  path?: string
  message: string
}
```

## 10. Execution Context

```ts
export interface ToolExecutionContext {
  runtimeId: string
  workspaceId?: string
  sessionId?: string
  transactionId?: string

  actor: ActorIdentity
  environment: ExecutionEnvironment

  capabilities: CapabilityResolver
  events: EventEmitter
  signal: AbortSignal
}
```

Context MUST distinguish the actor requesting an operation from the model/provider that proposed it.

Example:

```yaml
actor:
  type: human
  id: engineer-42
agent:
  model: deepseek
  session: session-abc
```

## 11. Policy Evaluation

Policy answers:

> Is this operation allowed under the current context?

Policy input SHOULD include:

- tool identity
- input summary
- final risk classification
- actor identity and roles
- environment
- artifact references
- transaction metadata
- adapter metadata

Example result:

```ts
type PolicyDecision =
  | { effect: "allow" }
  | { effect: "deny"; reason: string }
  | { effect: "require_approval"; approval: ApprovalRequirement }
```

A deny decision MUST prevent tool execution.

## 12. Preconditions

Tools MAY declare or dynamically resolve deterministic preconditions.

Examples:

- expected artifact version
- simulation mode required
- machine must be stopped
- target must exist
- deployment slot must be available

Preconditions are distinct from policy.

```text
Policy       → allowed?
Precondition → executable now?
```

## 13. Approval

Approval is required when policy or the tool's static contract demands it.

The approval request SHOULD include a human-reviewable summary:

```yaml
tool: plc.runtime.deploy
risk: L3
actor: engineer-42
target: plc://line-1/project
summary: Deploy ChangeSet cs-123 to production runtime
changeset: cs-123
```

Approval SHOULD be bound to the exact tool call or transaction state being approved.

Material input changes MUST invalidate previous approval unless policy explicitly permits reuse.

## 14. Transaction Integration

Mutation tools SHOULD participate in an Axrail transaction.

Tools declare whether a transaction is required:

```yaml
effects:
  mutatesArtifacts: true
  requiresTransaction: true
```

A runtime MAY:

- join an existing transaction
- automatically create a transaction
- reject execution if no transaction exists

based on host policy.

L3-L5 operations SHOULD normally require an explicit transaction or equivalent execution boundary.

## 15. Execution

Only after policy, preconditions, approval, and transaction checks pass may `execute()` run.

Adapters MUST NOT be invoked earlier for side-effecting operations.

The runtime SHOULD emit:

```text
tool.execution.started
```

immediately before the actual call.

## 16. Result Validation

A successful function return does not necessarily mean the engineering operation succeeded correctly.

Result validation MAY include:

- output schema validation
- adapter postconditions
- artifact version checks
- runtime state verification
- semantic validation
- physical feedback verification

Example:

```text
command returned success
        ↓
read device state
        ↓
verify expected transition
```

L4/L5 physical operations SHOULD support explicit postcondition verification whenever the underlying system exposes sufficient telemetry.

## 17. Tool Result

```ts
export interface ToolResult<O = unknown> {
  status: "succeeded" | "failed" | "cancelled"
  output?: O
  error?: ToolError

  provider: string
  startedAt: string
  finishedAt: string

  effects?: RecordedEffect[]
  validations?: ValidationResult[]
}
```

Tool results SHOULD avoid leaking secrets or credentials into model-visible context.

## 18. Error Taxonomy

Suggested errors:

```text
tool_not_found
tool_version_incompatible
tool_input_invalid
policy_denied
approval_required
approval_denied
precondition_failed
transaction_required
execution_timeout
execution_cancelled
adapter_error
output_invalid
postcondition_failed
rollback_failed
internal_error
```

Errors SHOULD indicate whether retry may be safe.

```ts
interface ToolError {
  code: string
  message: string
  retryable?: boolean
  details?: Record<string, unknown>
}
```

## 19. Cancellation and Timeouts

Every tool execution MUST receive an `AbortSignal` or equivalent cancellation primitive.

Tool definitions MAY specify timeout guidance:

```ts
interface ToolTimeoutPolicy {
  softMs?: number
  hardMs?: number
}
```

Cancellation of a side-effecting tool MUST NOT be assumed to undo already-applied effects.

The transaction layer is responsible for recovery or compensation.

## 20. Idempotency

Tools SHOULD declare whether repeating the same call is safe.

```yaml
effects:
  idempotent: true
```

For non-idempotent operations, the runtime SHOULD support an idempotency key when the adapter can honor it.

```ts
interface ToolInvocation {
  id: string
  idempotencyKey?: string
}
```

Idempotency metadata is especially important for recovery after network or process failures.

## 21. Audit Events

The runtime SHOULD emit structured events across the pipeline.

Suggested events:

```text
tool.requested
tool.resolved
tool.input.validated
tool.risk.classified
tool.policy.evaluated
tool.approval.requested
tool.approval.granted
tool.approval.denied
tool.execution.started
tool.execution.succeeded
tool.execution.failed
tool.validation.failed
tool.cancelled
```

Audit records SHOULD include:

- tool ID and version
- provider
- actor
- agent/session identity
- transaction ID
- risk level
- policy decision
- approval reference
- artifact references
- timestamps

Sensitive input values MAY be redacted.

## 22. Model Visibility

The model does not need access to every runtime field.

Tool descriptions exposed to a model SHOULD be separated from internal execution metadata.

```ts
interface ModelToolDescriptor {
  id: string
  description: string
  inputSchema: JsonSchema
}
```

Internal metadata such as policy implementation details, secrets, or credentials MUST NOT be exposed merely because a tool is model-callable.

## 23. Tool Categories

Axrail MAY define conventional categories without making them kernel-specific.

Examples:

```text
read
modify
deploy
runtime-control
safety-critical
simulation
validation
```

Categories supplement risk levels and MAY be used by policy engines.

## 24. MCP Tools

MCP tools entering Axrail MUST be wrapped as Axrail tools before privileged execution.

```text
MCP tool
   ↓
Axrail Tool Descriptor
   ↓
Risk classification
   ↓
Policy
   ↓
Approval
   ↓
Transaction
   ↓
Execute MCP call
```

An MCP server's own tool schema MUST NOT imply trust.

## 25. Physical Actions

L4/L5 operations require additional caution.

Axrail is not a replacement for deterministic machine safety systems.

The runtime SHOULD support host policies such as:

- prohibit physical actions entirely
- allow only when local operator is authenticated
- require machine mode confirmation
- require deterministic safety preconditions
- require manual confirmation at the target system
- require explicit postcondition verification

No AI approval mechanism should be interpreted as satisfying functional-safety requirements.

## 26. Dry Run and Simulation

Tools MAY expose dry-run or simulation capability.

Preferred approach:

```ts
interface ToolExecutionMode {
  mode: "execute" | "dry-run" | "simulate"
}
```

Hosts SHOULD prefer simulation for high-risk workflows when an accurate simulation provider exists.

## 27. Example Tool

```ts
const addHmiComponent: AxrailTool<AddComponentInput, AddComponentOutput> = {
  id: "hmi.component.add",
  version: "1.0.0",
  description: "Add a component to an HMI screen",
  inputSchema,
  outputSchema,

  risk: {
    level: "L2",
    category: ["modify", "hmi"]
  },

  effects: {
    mutatesArtifacts: true,
    externalSideEffects: false,
    physicalSideEffects: false,
    reversible: true,
    requiresTransaction: true,
    idempotent: false
  },

  async execute(ctx, input) {
    return ctx.get<HmiAdapter>("vendor.hmi.adapter")
      .addComponent(input)
  }
}
```

## 28. v0.1 Minimum Implementation

The initial implementation SHOULD include:

- namespaced tool IDs
- input schema validation
- static risk descriptors
- execution context
- policy hook
- approval hook
- transaction hook
- cancellation
- structured ToolResult
- structured ToolError
- audit events

Deferred:

- distributed tool execution
- cryptographic approval binding
- automatic risk inference
- process-level tool sandboxing
- remote attestation

## 29. Open Questions

1. Should risk levels remain fixed L0-L5 or become named policy profiles?
2. Should all mutating tools require a ChangeSet, or only engineering modifications?
3. Should `execute()` be inaccessible outside Tool Runtime by convention or by stronger API design?
4. How should long-running deployment operations report progress?
5. How should physical-action tools represent deterministic safety interlocks without mixing safety logic into the Axrail kernel?
