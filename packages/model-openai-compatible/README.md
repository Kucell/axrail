# @axrail/model-openai-compatible

A model-provider adapter for OpenAI-compatible Responses APIs.

It maps Axrail `AgentMessage` history and `AgentModelTool` contracts to the Responses API and normalizes `message` / `function_call` output back into `AgentModelResponse`.

The provider intentionally ignores reasoning items and only returns observable text and tool calls to Axrail sessions.

## OpenAI

```ts
const model = new OpenAICompatibleResponsesProvider({
  model: "gpt-5.6",
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: "https://api.openai.com/v1",
})
```

## DeepSeek

DeepSeek currently exposes a compatible `/responses` API, so the same provider can be configured with a DeepSeek base URL and model ID.

```ts
const model = new OpenAICompatibleResponsesProvider({
  model: "deepseek-flash",
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl: "https://api.deepseek.com",
})
```

No provider API key is stored by Axrail; applications inject credentials at runtime.
