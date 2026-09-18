# @axrail/model-ai-sdk

Vercel AI SDK bridge for Axrail's stable `AgentModelProvider` contract.

> Status: post-RC / v0.2 development. Requires Node.js 22.13+.

## Purpose

Axrail should not maintain separate HTTP request/response protocol adapters for every model vendor.

```text
@axrail/interaction-sdk
       ↓
AgentModelProvider
       ▲
@axrail/model-ai-sdk
       ↓
Vercel AI SDK LanguageModel
       ↓
OpenAI / Anthropic / Google / Azure / Bedrock / compatible providers
```

The bridge performs one model step. Axrail AgentLoop still owns tool execution and multi-step reasoning.

## Example

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { AiSdkModelProvider } from "@axrail/model-ai-sdk";

const provider = new AiSdkModelProvider({
  id: "claude-sonnet",
  model: anthropic("claude-sonnet-4-5"),
});

interaction.models.register({
  descriptor: {
    id: "claude-sonnet",
    providerId: "anthropic",
    capabilities: {
      toolCalling: true,
      reasoning: true,
    },
  },
  provider,
});
```

Provider-specific packages and credentials are owned by the embedding application.

## Governance boundary

The bridge gives Vercel AI SDK tool schemas **without execute handlers**.

Therefore:

```text
AI SDK produces tool call
        ↓
Axrail AgentLoop
        ↓
Axrail ToolRuntime
        ↓
Policy / Approval / Audit
        ↓
Tool execution
```

Vercel AI SDK does not become a second engineering Tool runtime.

## Existing provider

`@axrail/model-openai-compatible` remains available as a lightweight/reference compatibility implementation. New vendor integrations should prefer AI SDK provider packages through this bridge.

## Published integration baseline

For real product integration, pin the published prerelease:

```bash
pnpm add @axrail/model-ai-sdk@0.2.0-alpha.1
```

The npm prerelease uses the `next` dist-tag. An npm package page may still show `0.1.0-rc.1` as its default visible version because `latest` / `rc` were intentionally not moved.

Verify the exact package directly:

```bash
npm view @axrail/model-ai-sdk@0.2.0-alpha.1 version
```

Use the exact `0.2.0-alpha.1` version in HMI integration repositories so later prereleases cannot silently change the resolved Axrail baseline.
