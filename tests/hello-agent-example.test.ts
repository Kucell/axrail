import assert from "node:assert/strict";
import test from "node:test";

import { runHelloAgentExample } from "../examples/hello-agent/src/example.ts";

test("hello-agent demonstrates read and approved engineering-write paths", async () => {
  const result = await runHelloAgentExample();

  assert.equal(result.status, "completed");
  assert.equal(result.project.name, "Axrail Demo Project");
  assert.match(result.content ?? "", /governed rename/);

  assert.ok(result.eventTypes.includes("tool.execution.requested"));
  assert.ok(result.eventTypes.includes("tool.policy.evaluated"));
  assert.ok(result.eventTypes.includes("tool.approval.requested"));
  assert.ok(result.eventTypes.includes("tool.approval.completed"));
  assert.ok(result.eventTypes.includes("tool.execution.succeeded"));
  assert.ok(result.eventTypes.includes("session.completed"));
});
