import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelProviderError,
  OpenAICompatibleResponsesProvider,
} from "../packages/model-openai-compatible/src/index.ts";

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body; },
  } as Response;
}

test("OpenAI-compatible provider validates construction and fetch availability", () => {
  assert.throws(() => new OpenAICompatibleResponsesProvider({ model: "" }), /Model id must not be empty/);

  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", { value: undefined, configurable: true, writable: true });
  try {
    assert.throws(
      () => new OpenAICompatibleResponsesProvider({ model: "m" }),
      /fetch implementation is required/,
    );
  } finally {
    Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true, writable: true });
  }
});

test("OpenAI-compatible provider builds minimal and fully configured Responses requests", async () => {
  const requests: Array<{ url: string; init: RequestInit; body: any }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init, body: JSON.parse(String(init.body)) });
    return response(JSON.stringify({ id: "r", model: "m", status: "completed", output: [], usage: { input_tokens: 1 } }));
  };

  const minimal = new OpenAICompatibleResponsesProvider({ model: "m", fetch: fetchImpl });
  assert.equal(minimal.id, "openai-compatible:m");
  const minimalResult = await minimal.complete({ messages: [], tools: [] });
  assert.equal(minimalResult.stopReason, "completed");
  assert.equal(minimalResult.content, undefined);
  assert.equal(minimalResult.toolCalls, undefined);
  assert.equal(requests[0]?.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(requests[0]?.body, { model: "m", input: [] });
  assert.equal((requests[0]?.init.headers as Record<string, string>).authorization, undefined);

  const configured = new OpenAICompatibleResponsesProvider({
    model: "m2",
    id: "custom",
    baseUrl: "https://example.test/v1///",
    apiKey: async () => "secret",
    headers: { "x-extra": "yes" },
    fetch: fetchImpl,
    maxOutputTokens: 100,
    temperature: 0,
    extraBody: { vendor: true },
  });
  assert.equal(configured.id, "custom");
  await configured.complete({
    messages: [
      { role: "system", content: "one" },
      { role: "system", content: "two" },
      { role: "user", content: "hello" },
    ],
    tools: [{ name: "tool", description: "d" }],
  });
  assert.equal(requests[1]?.url, "https://example.test/v1/responses");
  assert.equal((requests[1]?.init.headers as Record<string, string>).authorization, "Bearer secret");
  assert.equal((requests[1]?.init.headers as Record<string, string>)["x-extra"], "yes");
  assert.equal(requests[1]?.body.instructions, "one\n\ntwo");
  assert.equal(requests[1]?.body.max_output_tokens, 100);
  assert.equal(requests[1]?.body.temperature, 0);
  assert.equal(requests[1]?.body.vendor, true);
  assert.deepEqual(requests[1]?.body.tools[0].parameters, {
    type: "object",
    properties: {},
    additionalProperties: true,
  });

  const staticKey = new OpenAICompatibleResponsesProvider({ model: "m", apiKey: "static", fetch: fetchImpl });
  await staticKey.complete({ messages: [], tools: [] });
  assert.equal((requests[2]?.init.headers as Record<string, string>).authorization, "Bearer static");
});

test("Responses history normalization handles empty content, tool output and assistant calls", async () => {
  let body: any;
  const provider = new OpenAICompatibleResponsesProvider({
    model: "m",
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return response(JSON.stringify({ output: [] }));
    },
  });
  await provider.complete({
    messages: [
      { role: "system", content: "" },
      { role: "user", content: "" },
      { role: "tool", toolCallId: "call-1", content: undefined },
      { role: "assistant", content: "assistant", toolCalls: [
        { id: "call-2", name: "x", input: undefined },
      ] },
    ],
    tools: [],
  });
  assert.equal(body.instructions, undefined);
  assert.deepEqual(body.input, [
    { type: "function_call_output", call_id: "call-1", output: "" },
    { type: "message", role: "assistant", content: "assistant" },
    { type: "function_call", call_id: "call-2", name: "x", arguments: "{}" },
  ]);

  await assert.rejects(
    provider.complete({ messages: [{ role: "tool", content: "no id" }], tools: [] }),
    (error: unknown) => (error as ModelProviderError).code === "invalid_history",
  );
});

test("Responses response normalization covers message text, skips malformed parts and parses calls", async () => {
  const provider = new OpenAICompatibleResponsesProvider({
    model: "m",
    fetch: async () => response(JSON.stringify({
      id: "r1",
      model: "returned-model",
      status: "incomplete",
      usage: { output_tokens: 2 },
      output: [
        null,
        "invalid",
        { type: "message", content: "not-array" },
        { type: "message", content: [
          null,
          { type: "image", text: "ignored" },
          { type: "text", text: "first" },
          { type: "output_text", text: "second" },
        ] },
        { type: "function_call", call_id: "call", name: "tool", arguments: "" },
      ],
    })),
  });
  const result = await provider.complete({ messages: [], tools: [] });
  assert.equal(result.content, "first\nsecond");
  assert.deepEqual(result.toolCalls, [{ id: "call", name: "tool", input: {} }]);
  assert.equal(result.stopReason, "tool_calls");
  assert.equal(result.metadata?.responseId, "r1");
  assert.equal(result.metadata?.model, "returned-model");
});

test("Responses provider reports HTTP, JSON, shape and malformed call errors", async () => {
  const http = new OpenAICompatibleResponsesProvider({
    model: "m",
    fetch: async () => response(JSON.stringify({ error: { message: "quota" } }), 429),
  });
  await assert.rejects(http.complete({ messages: [], tools: [] }), (error: unknown) => {
    const modelError = error as ModelProviderError;
    assert.equal(modelError.code, "provider_http_error");
    assert.equal(modelError.status, 429);
    assert.equal(modelError.message, "quota");
    return true;
  });

  const httpFallback = new OpenAICompatibleResponsesProvider({ model: "m", fetch: async () => response("{}", 500) });
  await assert.rejects(httpFallback.complete({ messages: [], tools: [] }), /HTTP 500/);

  const invalidJson = new OpenAICompatibleResponsesProvider({ model: "m", fetch: async () => response("{") });
  await assert.rejects(invalidJson.complete({ messages: [], tools: [] }), (error: unknown) => (error as ModelProviderError).code === "invalid_provider_response");

  const nonObject = new OpenAICompatibleResponsesProvider({ model: "m", fetch: async () => response("null") });
  await assert.rejects(nonObject.complete({ messages: [], tools: [] }), /Expected response object/);

  for (const call of [
    { type: "function_call", call_id: "id", arguments: "{}" },
    { type: "function_call", name: "tool", arguments: "{}" },
  ]) {
    const malformed = new OpenAICompatibleResponsesProvider({
      model: "m",
      fetch: async () => response(JSON.stringify({ output: [call] })),
    });
    await assert.rejects(malformed.complete({ messages: [], tools: [] }), (error: unknown) => {
      assert.ok(["invalid_provider_response", "invalid_tool_call"].includes((error as ModelProviderError).code));
      return true;
    });
  }

  const fallbackId = new OpenAICompatibleResponsesProvider({
    model: "m",
    fetch: async () => response(JSON.stringify({ output: [{ type: "function_call", id: "fallback-id", name: "tool", arguments: "{}" }] })),
  });
  assert.equal((await fallbackId.complete({ messages: [], tools: [] })).toolCalls?.[0]?.id, "fallback-id");
});
