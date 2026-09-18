# RFC 0013: Vercel AI SDK Model Provider Convergence

Status: **Draft / implemented foundation for v0.2**

## Summary

Axrail v0.2 raises its minimum runtime to Node.js 22.13+ and adds `@axrail/model-ai-sdk` as the preferred multi-provider bridge.

`AgentModelProvider` remains the stable Axrail model boundary.

## Decision

```text
Interaction ModelRegistry
        ↓
AgentModelProvider
        ▲
@axrail/model-ai-sdk
        ↓
Vercel AI SDK
        ↓
provider packages
```

Harness remains model-agnostic.

## Node baseline

Post-RC/v0.2:
- Node >=22.13.0
- CI 22 / 24 / 26

Published RC1 remains historical Node >=20 and is not rewritten.

## Why convergence

Maintaining one Axrail HTTP client per model vendor duplicates:
- request schemas;
- tool calling formats;
- response normalization;
- vendor version drift;
- error/metadata behavior.

A mature provider abstraction should absorb that protocol churn while Axrail focuses on governed engineering execution.

## Bridge contract

`AiSdkModelProvider`:
1. accepts a caller-created AI SDK `LanguageModel`;
2. maps Axrail messages/tools into AI SDK inputs;
3. invokes exactly one `generateText` step;
4. maps text/tool calls back to `AgentModelResponse`;
5. propagates AbortSignal;
6. preserves non-secret usage/provider metadata.

## Tool authority

The bridge supplies Tool schemas without execute handlers.

AI SDK may decide to request a Tool, but cannot execute an Axrail engineering Tool.

Tool execution remains:

```text
AgentLoop → ToolRuntime → Policy/Approval/Audit → Tool
```

This is a required architecture invariant.

## Provider packages

The bridge does not depend on vendor packages such as `@ai-sdk/openai` or `@ai-sdk/anthropic`.

Applications install the providers they actually need and pass the resulting LanguageModel to Axrail.

This prevents Axrail from owning vendor credentials or provider package selection.

## Retry policy

The bridge defaults AI SDK `maxRetries` to 0.

Axrail does not silently add extra model requests/cost. Applications may explicitly opt into retry behavior.

## Existing native provider

`@axrail/model-openai-compatible` remains as a lightweight/reference compatibility provider.

It is not the default pattern for adding every future vendor.

## Non-goals

- AI SDK Agent/Workflow orchestration;
- AI Gateway mandate;
- model marketplace;
- credential manager;
- automatic model router/fallback;
- removal of the RC1 native provider.

## Validation

Required:
- Tool definitions contain no `execute`;
- message/tool-result mapping tests;
- text/tool-call normalization tests;
- AbortSignal and provider metadata tests;
- Node 22/24/26 CI;
- package smoke including `@axrail/model-ai-sdk`;
- global coverage >=95%.
