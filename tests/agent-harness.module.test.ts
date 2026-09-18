import assert from "node:assert/strict";
import test from "node:test";

import { AgentLoop, AgentSession } from "../packages/agent/src/index.ts";
import { collectEvents } from "../packages/events/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";
import { ToolRuntime } from "../packages/tools/src/index.ts";

test("AgentLoop validates maxSteps and cancels before model execution", async () => {
  const tools = new ToolRuntime();
  const model = {
    id: "never",
    async complete() {
      throw new Error("model should not run");
    },
  };

  assert.throws(
    () => new AgentLoop({ model, tools, maxSteps: 0 }),
    /maxSteps must be at least 1/,
  );

  const controller = new AbortController();
  controller.abort();
  const events: string[] = [];
  const agent = new AgentLoop({
    model,
    tools,
    onEvent(event) {
      events.push(event.type);
    },
  });

  const result = await agent.run("cancel", { signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(result.steps, 0);
  assert.deepEqual(events, ["agent.cancelled"]);
});

test("AgentLoop returns max_steps after exhausting a governed tool cycle", async () => {
  const tools = new ToolRuntime();
  tools.registry.register({
    name: "read.once",
    description: "Read one value",
    risk: "L0",
    effect: "read",
    execute() {
      return { ok: true };
    },
  });

  const events: string[] = [];
  const agent = new AgentLoop({
    tools,
    maxSteps: 1,
    onEvent(event) {
      events.push(event.type);
    },
    model: {
      id: "looping",
      async complete() {
        return {
          toolCalls: [{ id: "call-1", name: "read.once", input: {} }],
          stopReason: "tool_calls",
        };
      },
    },
  });

  const result = await agent.run("keep going");
  assert.equal(result.status, "max_steps");
  assert.equal(result.steps, 1);
  assert.ok(events.includes("agent.max_steps"));
});

test("AgentLoop records a safe fallback when a Tool result cannot be serialized", async () => {
  const tools = new ToolRuntime();
  tools.registry.register({
    name: "read.circular",
    description: "Return a circular object",
    risk: "L0",
    effect: "read",
    execute() {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    },
  });

  let calls = 0;
  const agent = new AgentLoop({
    tools,
    model: {
      id: "serialization-check",
      async complete(request) {
        calls += 1;
        if (calls === 1) {
          return {
            toolCalls: [{ id: "circular", name: "read.circular", input: {} }],
            stopReason: "tool_calls",
          };
        }
        const toolMessage = request.messages.find((message) => message.role === "tool");
        assert.match(toolMessage?.content ?? "", /tool_result_serialization_failed/);
        return { content: "recovered", stopReason: "completed" };
      },
    },
  });

  const result = await agent.run("read circular");
  assert.equal(result.status, "completed");
  assert.equal(result.content, "recovered");
});

test("AgentSession clones message arrays and freezes stored message payloads", () => {
  const session = new AgentSession();
  assert.match(session.id, /^session_/);

  const metadata = { source: "test" };
  const call = { id: "call", name: "read", input: {} };
  session.append({
    role: "assistant",
    content: "x",
    metadata,
    toolCalls: [call],
  });

  const messages = session.messages();
  assert.equal(Object.isFrozen(messages[0]), true);
  assert.equal(Object.isFrozen(messages[0]?.metadata), true);
  assert.equal(Object.isFrozen(messages[0]?.toolCalls?.[0]), true);
  assert.notEqual(messages, session.messages());
});

test("HarnessAgent persists cancellation and uses Harness environment fallback", async () => {
  const harness = new HarnessRuntime({ environment: "design" });
  const controller = new AbortController();
  controller.abort();

  const agent = harness.createAgent({
    model: {
      id: "not-called",
      async complete() {
        throw new Error("model should not run");
      },
    },
  });

  const result = await agent.run("cancelled run", {
    sessionId: "ses-cancelled",
    signal: controller.signal,
  });
  assert.equal(result.status, "cancelled");

  const events = await collectEvents(harness.events, { sessionId: "ses-cancelled" });
  assert.ok(events.some((event) => event.type === "session.cancelled"));

  const environmentAgent = harness.createAgent({
    model: {
      id: "environment",
      async complete(request) {
        assert.equal(request.metadata?.environment, "design");
        return { content: "ok", stopReason: "completed" };
      },
    },
  });
  const completed = await environmentAgent.run("environment", {
    sessionId: "ses-environment",
  });
  assert.equal(completed.status, "completed");
});

test("HarnessAgent persists failed session state for non-Error model failures", async () => {
  const harness = new HarnessRuntime();
  const agent = harness.createAgent({
    model: {
      id: "fails",
      async complete() {
        throw "string failure";
      },
    },
  });

  let caught: unknown;
  try {
    await agent.run("fail", { sessionId: "ses-failed" });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, "string failure");

  const events = await collectEvents(harness.events, { sessionId: "ses-failed" });
  const failed = events.find((event) => event.type === "session.failed");
  assert.ok(failed);
  assert.match(JSON.stringify(failed?.data), /string failure/);
});
