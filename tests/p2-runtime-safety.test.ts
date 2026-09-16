import assert from "node:assert/strict";
import test from "node:test";

import { AgentLoop } from "../packages/agent/src/index.ts";
import { ToolRuntime } from "../packages/tools/src/index.ts";
import { TransactionRuntime } from "../packages/transactions/src/index.ts";

test("AbortSignal cancellation emits transaction.cancelled through the normal transition path", async () => {
  const controller = new AbortController();
  controller.abort();

  let applied = false;
  const events: string[] = [];
  const runtime = new TransactionRuntime({
    allowWithoutPolicy: true,
    executor: {
      id: "cancel-test",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
    onEvent(event) {
      events.push(event.type);
    },
  });

  const result = await runtime.execute(
    {
      id: "cs-cancelled",
      protocolVersion: "0.1",
      artifacts: [],
      operations: [{ op: "update", target: "draft", risk: { level: "L1" } }],
    },
    { signal: controller.signal },
  );

  assert.equal(result.state, "cancelled");
  assert.equal(result.error?.code, "cancelled");
  assert.equal(applied, false);
  assert.deepEqual(events, ["transaction.preparing", "transaction.cancelled"]);
});

test("AgentLoop stops later same-turn Tool execution after a failure by default", async () => {
  let secondExecuted = false;
  const events: string[] = [];
  const tools = new ToolRuntime({
    policy: {
      evaluate() {
        return { allow: true };
      },
    },
  });

  tools.registry.register({
    name: "engineering.fail",
    description: "Fail first",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      throw new Error("first Tool failed");
    },
  });
  tools.registry.register({
    name: "engineering.must-not-run",
    description: "Would cause a later side effect",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      secondExecuted = true;
      return { changed: true };
    },
  });

  let modelCalls = 0;
  const agent = new AgentLoop({
    tools,
    onEvent(event) {
      events.push(event.type);
    },
    model: {
      id: "failure-aware-model",
      async complete(request) {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            toolCalls: [
              { id: "call-fail", name: "engineering.fail", input: {} },
              {
                id: "call-skipped",
                name: "engineering.must-not-run",
                input: {},
              },
            ],
            stopReason: "tool_calls",
          };
        }

        const toolMessages = request.messages.filter((message) => message.role === "tool");
        assert.equal(toolMessages.length, 2);
        assert.match(toolMessages[0].content ?? "", /execution_failed/);
        assert.match(toolMessages[1].content ?? "", /skipped_after_tool_failure/);
        return { content: "replanned safely", stopReason: "completed" };
      },
    },
  });

  const result = await agent.run("perform engineering work");

  assert.equal(result.status, "completed");
  assert.equal(result.content, "replanned safely");
  assert.equal(secondExecuted, false);
  assert.ok(events.includes("agent.tool.skipped"));
  assert.ok(events.includes("agent.tool_batch.stopped"));
});

test("AgentLoop can explicitly continue later same-turn Tools after a failure", async () => {
  let secondExecuted = false;
  const tools = new ToolRuntime({
    policy: {
      evaluate() {
        return { allow: true };
      },
    },
  });

  tools.registry.register({
    name: "first.fail",
    description: "Fail first",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      throw new Error("expected failure");
    },
  });
  tools.registry.register({
    name: "second.continue",
    description: "Continue explicitly",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      secondExecuted = true;
      return "ok";
    },
  });

  let modelCalls = 0;
  const agent = new AgentLoop({
    tools,
    toolFailureMode: "continue",
    model: {
      id: "continue-model",
      async complete() {
        modelCalls += 1;
        return modelCalls === 1
          ? {
              toolCalls: [
                { id: "a", name: "first.fail", input: {} },
                { id: "b", name: "second.continue", input: {} },
              ],
              stopReason: "tool_calls",
            }
          : { content: "done", stopReason: "completed" };
      },
    },
  });

  await agent.run("continue mode");
  assert.equal(secondExecuted, true);
});
