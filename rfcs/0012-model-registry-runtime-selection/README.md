# RFC 0012: Model Registry and Runtime Model Selection

Status: **Draft / implementation in progress**

## Summary

Axrail adds model registration and explicit per-turn model selection to `@axrail/interaction-sdk`.

The design keeps:

- `AgentModelProvider` in `@axrail/agent` as the model protocol;
- concrete vendor transports in `@axrail/model-*` or third-party packages;
- model registry, model picker data, runtime selection, capability checks and provenance in `@axrail/interaction-sdk`;
- `@axrail/harness` model-agnostic.

## 1. Motivation

Third-party engineering applications should not separately invent:

- model lists;
- model picker mapping;
- default model semantics;
- per-turn model switching;
- capability validation;
- model provenance.

These concerns are reusable interaction-layer behavior.

## 2. Registry contract

The first-version registry stores:

```text
logical model descriptor
+
AgentModelProvider instance
```

Logical model ID is the stable ID exposed to UI/application code.

## 3. Resolution order

```text
explicit send.modelId
  ↓
configured defaultModelId
  ↓
single registered model
  ↓
otherwise fail closed
```

Unknown model IDs fail closed.

There is no automatic fallback.

## 4. Backward-compatible convenience

Existing post-RC usage:

```ts
new InteractionRuntime({
  harness,
  model,
})
```

remains supported.

The runtime registers that provider as a single logical model using the provider's `id`.

More advanced applications can provide a `ModelRegistry`.

## 5. Capabilities

First-version capability vocabulary:

```text
toolCalling
structuredOutput
vision
reasoning
streaming
```

Required capabilities must be explicitly true on the selected descriptor.

Unknown support does not satisfy a requirement.

## 6. Plugin registration

`InteractionPluginApi` gains `registerModel()`.

Registration is reversible and participates in setup rollback.

A model plugin remains on the intent side and receives no additional engineering execution authority.

## 7. Provenance

The selected model produces:

```text
modelId
modelProviderId
runtimeProviderId
```

This information is included in interaction events/results and Agent metadata.

It must not reduce Policy, Approval or risk requirements.

## 8. Credentials

Model credentials remain private to concrete providers.

The public descriptor intentionally contains no API key/token/secret field.

Provider implementations may resolve credentials from environment variables, OS keychains, Vault, Kubernetes Secrets or organization-specific secret managers.

## 9. Mutable model state

The first version does not add `setDefaultModel()`.

Applications that expose a model picker should pass `modelId` explicitly on each interaction turn.

This avoids cross-user/cross-session races when an InteractionRuntime is shared.

## 10. Router/fallback

Automatic routing and fallback are deferred.

They require real evidence around:

- model capability truth;
- tool-calling behavior;
- latency/cost constraints;
- error classification;
- explicit user preference;
- regulated provenance requirements.

Silent fallback is especially undesirable in engineering workflows because it changes model provenance.

## 11. Security and governance

Model identity is provenance, not authority.

```text
selected model
  ↓
can propose intent

selected model
  ✗ cannot approve itself
  ✗ cannot lower Tool risk
  ✗ cannot bypass Transaction
  ✗ cannot change engineering provider identity
```

## 12. Validation

Acceptance requires:

- deterministic registry semantics;
- explicit/default/singleton/ambiguous resolution tests;
- capability fail-closed tests;
- plugin model registration + rollback tests;
- provenance event/result/Session metadata tests;
- credential-free descriptor;
- Node 20/22/24 CI;
- global line/function/branch coverage >=95%.
