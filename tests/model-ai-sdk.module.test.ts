import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentMessage,
  AgentModelTool,
} from "../packages/agent/src/index.ts";
import {
  AiSdkModelProvider,
  fromAiSdkResult,
  toAiSdkPrompt,
  toAiSdkTools,
} from "../packages/model-ai-sdk/src/index.ts";

test("AI SDK bridge converts Axrail conversation history without delegating Tool execution", () => {
  const messages: AgentMessage[] = [
    { role: "system", content: "System A" },
    { role: "system", content: "System B" },
    { role: "user", content: "Move the pump" },
    {
      role: "assistant",
      content: "I will inspect first.",
      toolCalls: [
        {
          id: "call-1",
          name: "hmi.project.inspect",
          input: { projectId: "p1" },
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "call-1",
      name: "hmi.project.inspect",
      content: JSON.stringify({ ok: true, value: { projectId: "p1" } }),
    },
    { role: "assistant", content: "Done." },
  ];

  const prompt = toAiSdkPrompt(messages);
  assert.equal(prompt.system, "System A\n\nSystem B");
  assert.equal(prompt.messages.length, 4);

  const assistant = prompt.messages[1] as {
    role: string;
    content: Array<Record<string, unknown>>;
  };
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content[0]?.type, "text");
  assert.equal(assistant.content[1]?.type, "tool-call");
  assert.equal(assistant.content[1]?.toolCallId, "call-1");
  assert.equal(assistant.content[1]?.toolName, "hmi.project.inspect");
  assert.deepEqual(assistant.content[1]?.input, { projectId: "p1" });

  const toolMessage = prompt.messages[2] as {
    role: string;
    content: Array<Record<string, unknown>>;
  };
  assert.equal(toolMessage.role, "tool");
  assert.equal(toolMessage.content[0]?.type, "tool-result");
  assert.equal(toolMessage.content[0]?.toolCallId, "call-1");

  const tools = toAiSdkTools([
    {
      name: "hmi.component.update",
      description: "Update a component",
      inputSchema: {
        type: "object",
        properties: {
          componentId: { type: "string" },
        },
        required: ["componentId"],
      },
      risk: "L2",
      effect: "engineering-write",
    },
  ]);

  const aiTool = tools["hmi.component.update"] as Record<string, unknown>;
  assert.equal(typeof aiTool, "object");
  assert.equal(aiTool.description, "Update a component");
  assert.equal(aiTool.execute, undefined);
});

test("AI SDK bridge validates malformed Tool history and duplicate model tools", () => {
  assert.throws(
    () => toAiSdkPrompt([
      { role: "tool", name: "x", content: "result" },
    ]),
    /requires toolCallId/,
  );
  assert.throws(
    () => toAiSdkPrompt([
      { role: "tool", toolCallId: "call", content: "result" },
    ]),
    /requires name/,
  );

  const toolDef: AgentModelTool = {
    name: "duplicate",
    description: "duplicate",
    risk: "L0",
    effect: "read",
  };
  assert.throws(
    () => toAiSdkTools([toolDef, toolDef]),
    /Duplicate Axrail model tool name/,
  );
  assert.throws(
    () => toAiSdkTools([{
      ...toolDef,
      name: " ",
    }]),
    /model tool name must not be empty/,
  );
});

test("AI SDK bridge normalizes text, Tool calls, finish reason and metadata", () => {
  const response = fromAiSdkResult({
    text: "Inspecting",
    toolCalls: [
      {
        toolCallId: "tc-1",
        toolName: "hmi.project.inspect",
        input: { projectId: "p1" },
      },
    ],
    finishReason: { unified: "tool-calls" },
    usage: { inputTokens: 10, outputTokens: 4 },
    providerMetadata: { provider: { trace: "abc" } },
    warnings: ["warning"],
    response: { id: "provider-response" },
  });

  assert.equal(response.content, "Inspecting");
  assert.equal(response.stopReason, "tool_calls");
  assert.deepEqual(response.toolCalls, [{
    id: "tc-1",
    name: "hmi.project.inspect",
    input: { projectId: "p1" },
  }]);
  assert.deepEqual(response.metadata, {
    usage: { inputTokens: 10, outputTokens: 4 },
    providerMetadata: { provider: { trace: "abc" } },
    warnings: ["warning"],
    response: { id: "provider-response" },
  });

  assert.equal(
    fromAiSdkResult({ finishReason: "stop" }).stopReason,
    "stop",
  );
  assert.equal(
    fromAiSdkResult({ finishReason: { unified: "length" } }).stopReason,
    "length",
  );
  assert.equal(
    fromAiSdkResult({ finishReason: null }).stopReason,
    "completed",
  );
  assert.equal(
    fromAiSdkResult({ text: "" }).content,
    undefined,
  );

  assert.throws(
    () => fromAiSdkResult({
      toolCalls: [{
        toolCallId: "",
        toolName: "tool",
        input: {},
      }],
    }),
    /toolCallId must not be empty/,
  );
  assert.throws(
    () => fromAiSdkResult({
      toolCalls: [{
        toolCallId: "call",
        toolName: "",
        input: {},
      }],
    }),
    /toolName must not be empty/,
  );
});

test("AiSdkModelProvider executes exactly one AI SDK generation step and preserves Axrail control", async () => {
  let observed: Record<string, unknown> | undefined;
  const signal = new AbortController().signal;

  const provider = new AiSdkModelProvider({
    id: "ai-sdk:test",
    model: {} as never,
    maxRetries: 0,
    providerOptions: {
      test: {
        reasoning: true,
      },
    },
    generateText: (async (options: Record<string, unknown>) => {
      observed = options;
      return {
        text: "Need a Tool",
        toolCalls: [{
          toolCallId: "tool-call-1",
          toolName: "read.status",
          input: { id: "asset-1" },
        }],
        finishReason: "tool-calls",
        usage: { inputTokens: 2, outputTokens: 3 },
      };
    }) as never,
  });

  const result = await provider.complete({
    messages: [
      { role: "system", content: "Engineering assistant" },
      { role: "user", content: "Read status" },
    ],
    tools: [{
      name: "read.status",
      description: "Read status",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
      },
      risk: "L0",
      effect: "read",
    }],
    signal,
    metadata: {
      interactionId: "int-1",
    },
  });

  assert.equal(provider.id, "ai-sdk:test");
  assert.ok(observed);
  assert.equal(observed?.maxRetries, 0);
  assert.equal(observed?.abortSignal, signal);
  assert.deepEqual(observed?.providerOptions, {
    test: { reasoning: true },
  });
  assert.equal(observed?.system, "Engineering assistant");

  const tools = observed?.tools as Record<string, Record<string, unknown>>;
  assert.equal(tools["read.status"]?.execute, undefined);

  assert.deepEqual(result.toolCalls, [{
    id: "tool-call-1",
    name: "read.status",
    input: { id: "asset-1" },
  }]);
  assert.equal(result.stopReason, "tool_calls");
});

test("AiSdkModelProvider supports no-Tool turns and validates configuration", async () => {
  let observedTools: unknown = Symbol("unset");

  const provider = new AiSdkModelProvider({
    id: "simple",
    model: {} as never,
    generateText: (async (options: Record<string, unknown>) => {
      observedTools = options.tools;
      return {
        text: "Hello",
        finishReason: "stop",
      };
    }) as never,
  });

  const result = await provider.complete({
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
  });

  assert.equal(observedTools, undefined);
  assert.equal(result.content, "Hello");
  assert.equal(result.stopReason, "stop");

  assert.throws(
    () => new AiSdkModelProvider({
      id: " ",
      model: {} as never,
    }),
    /provider id must not be empty/,
  );
  assert.throws(
    () => new AiSdkModelProvider({
      id: "x",
      model: undefined as never,
    }),
    /language model is required/,
  );
  assert.throws(
    () => new AiSdkModelProvider({
      id: "x",
      model: {} as never,
      maxRetries: -1,
    }),
    /non-negative integer/,
  );
  assert.throws(
    () => new AiSdkModelProvider({
      id: "x",
      model: {} as never,
      maxRetries: 1.5,
    }),
    /non-negative integer/,
  );
});
