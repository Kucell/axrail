import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelProviderError,
  OpenAICompatibleResponsesProvider,
} from "../packages/model-openai-compatible/src/index.ts";

test("Responses provider normalizes Axrail tools and function calls", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;

  const provider = new OpenAICompatibleResponsesProvider({
    model: "test-model",
    apiKey: "test-key",
    baseUrl: "https://provider.example/v1/",
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({
          id: "resp-1",
          model: "test-model",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "call-1",
              name: "hmi.screen.create",
              arguments: JSON.stringify({ name: "Robot Overview" }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const response = await provider.complete({
    messages: [
      { role: "system", content: "Use governed engineering tools." },
      { role: "user", content: "Create a robot overview." },
    ],
    tools: [
      {
        name: "hmi.screen.create",
        description: "Create an HMI screen",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        risk: "L2",
        effect: "engineering-write",
      },
    ],
  });

  assert.equal(authorization, "Bearer test-key");
  assert.equal(requestBody?.model, "test-model");
  assert.equal(requestBody?.instructions, "Use governed engineering tools.");
  assert.deepEqual(requestBody?.input, [
    { type: "message", role: "user", content: "Create a robot overview." },
  ]);
  assert.deepEqual(requestBody?.tools, [
    {
      type: "function",
      name: "hmi.screen.create",
      description: "Create an HMI screen",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  ]);
  assert.equal(response.stopReason, "tool_calls");
  assert.deepEqual(response.toolCalls, [
    {
      id: "call-1",
      name: "hmi.screen.create",
      input: { name: "Robot Overview" },
    },
  ]);
});

test("Responses provider maps prior Axrail tool history to function_call items", async () => {
  let input: unknown;
  const provider = new OpenAICompatibleResponsesProvider({
    model: "test-model",
    fetch: async (_url, init) => {
      input = JSON.parse(String(init?.body)).input;
      return new Response(
        JSON.stringify({
          id: "resp-2",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Completed." }],
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const response = await provider.complete({
    messages: [
      { role: "user", content: "Create screen" },
      {
        role: "assistant",
        toolCalls: [
          { id: "call-existing", name: "hmi.screen.create", input: { name: "Overview" } },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-existing",
        name: "hmi.screen.create",
        content: JSON.stringify({ ok: true }),
      },
    ],
    tools: [],
  });

  assert.deepEqual(input, [
    { type: "message", role: "user", content: "Create screen" },
    {
      type: "function_call",
      call_id: "call-existing",
      name: "hmi.screen.create",
      arguments: JSON.stringify({ name: "Overview" }),
    },
    {
      type: "function_call_output",
      call_id: "call-existing",
      output: JSON.stringify({ ok: true }),
    },
  ]);
  assert.equal(response.content, "Completed.");
  assert.equal(response.stopReason, "completed");
});

test("Responses provider rejects malformed tool argument JSON", async () => {
  const provider = new OpenAICompatibleResponsesProvider({
    model: "test-model",
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: "resp-bad",
          output: [
            {
              type: "function_call",
              call_id: "bad-call",
              name: "unsafe.tool",
              arguments: "{not-json",
            },
          ],
        }),
        { status: 200 },
      ),
  });

  await assert.rejects(
    () => provider.complete({ messages: [{ role: "user", content: "go" }], tools: [] }),
    (error: unknown) =>
      error instanceof ModelProviderError && error.code === "invalid_tool_arguments",
  );
});
