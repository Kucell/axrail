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

test("AgentLoop ignores observational event failures by default after Tool success", async () => {
  let toolExecuted = false;
  const tools = new ToolRuntime();
  tools.registry.register({
    name: "read.status",
    description: "Read status",
    risk: "L0",
    effect: "read",
    execute() {
      toolExecuted = true;
      return { ready: true };
    },
  });

  let modelCalls = 0;
  const agent = new AgentLoop({
    tools,
    onEvent(event) {
      if (event.type === "agent.tool.completed") {
        throw new Error("telemetry sink unavailable");
      }
    },
    model: {
      id: "observer-failure-model",
      async complete() {
        modelCalls += 1;
        return modelCalls === 1
          ? {
              toolCalls: [{ id: "read-1", name: "read.status", input: {} }],
              stopReason: "tool_calls",
            }
          : { content: "completed despite telemetry failure", stopReason: "completed" };
      },
    },
  });

  const result = await agent.run("read status");
  assert.equal(toolExecuted, true);
  assert.equal(result.status, "completed");
  assert.equal(result.content, "completed despite telemetry failure");
});

test("AgentLoop can explicitly propagate authoritative event failures", async () => {
  const agent = new AgentLoop({
    tools: new ToolRuntime(),
    eventFailureMode: "propagate",
    onEvent() {
      throw new Error("authoritative event persistence failed");
    },
    model: {
      id: "not-reached",
      async complete() {
        return { content: "unexpected", stopReason: "completed" };
      },
    },
  });

  await assert.rejects(
    () => agent.run("fail on event persistence"),
    /authoritative event persistence failed/,
  );
});

test("read Tool result validation failure is a distinct postcondition error", async () => {
  const tools = new ToolRuntime();
  tools.registry.register({
    name: "read.invalid-result",
    description: "Read then reject result shape",
    risk: "L0",
    effect: "read",
    execute() {
      return { unexpected: true };
    },
    validateResult() {
      throw new Error("result schema mismatch");
    },
  });

  const result = await tools.execute({
    id: "read-invalid",
    name: "read.invalid-result",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "result_validation_failed");
  assert.deepEqual(result.error?.details, {
    phase: "result_validation",
    effectUncertain: false,
    retrySafe: true,
  });
});

test("side-effecting Tool result validation failure reports execution uncertainty", async () => {
  let effectApplied = false;
  const tools = new ToolRuntime({
    policy: {
      evaluate() {
        return { allow: true };
      },
    },
  });
  tools.registry.register({
    name: "engineering.invalid-result",
    description: "Write then reject returned result",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      effectApplied = true;
      return { malformed: true };
    },
    validateResult() {
      throw new Error("postcondition failed");
    },
  });

  const result = await tools.execute({
    id: "write-invalid",
    name: "engineering.invalid-result",
    input: {},
  });

  assert.equal(effectApplied, true);
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "execution_uncertain");
  assert.deepEqual(result.error?.details, {
    phase: "result_validation",
    effectUncertain: true,
    retrySafe: false,
  });
});
