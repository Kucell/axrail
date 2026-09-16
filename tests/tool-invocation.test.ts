import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolRuntime,
  type ToolInvocationEnvelope,
} from "../packages/tools/src/index.ts";

test("ToolRuntime uses one immutable effective invocation for policy, approval and execution", async () => {
  let policyInvocation: ToolInvocationEnvelope | undefined;
  let approvalInvocation: ToolInvocationEnvelope | undefined;
  let executedInput: unknown;

  const runtime = new ToolRuntime({
    policy: {
      evaluate(invocation) {
        policyInvocation = invocation;
        return { allow: true, requireApproval: true };
      },
    },
    approval: {
      approve(invocation) {
        approvalInvocation = invocation;
        return true;
      },
    },
  });

  runtime.registry.register({
    name: "hmi.screen.create",
    version: "0.1",
    providerId: "mock-hmi",
    description: "Create an HMI screen",
    risk: "L2",
    effect: "engineering-write",
    validateInput(input) {
      const raw = input as { projectId?: unknown; name?: unknown };
      if (typeof raw.projectId !== "string" || typeof raw.name !== "string") {
        throw new Error("projectId and name are required");
      }
      return {
        projectId: raw.projectId.trim(),
        name: raw.name.trim(),
      };
    },
    describeInvocation(input) {
      return {
        target: input.projectId,
        artifactRefs: [input.projectId],
        metadata: { screenName: input.name },
      };
    },
    execute(input) {
      executedInput = input;
      return { ok: true };
    },
  });

  const result = await runtime.execute(
    {
      id: "call-1",
      name: "hmi.screen.create",
      input: { projectId: " project:1 ", name: " Overview " },
    },
    {
      actorId: "engineer-1",
      sessionId: "session-1",
      metadata: { environment: "design", correlationId: "corr-1" },
    },
  );

  assert.equal(result.ok, true);
  assert.ok(policyInvocation);
  assert.strictEqual(policyInvocation, approvalInvocation);
  assert.equal(policyInvocation.target, "project:1");
  assert.deepEqual(policyInvocation.artifactRefs, ["project:1"]);
  assert.deepEqual(policyInvocation.input, {
    projectId: "project:1",
    name: "Overview",
  });
  assert.match(policyInvocation.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(policyInvocation), true);
  assert.equal(Object.isFrozen(policyInvocation.input), true);
  assert.equal(Object.isFrozen(policyInvocation.context), true);
  assert.strictEqual(executedInput, policyInvocation.input);
});

test("Tool invocation evidence digest changes when effective input changes", async () => {
  const digests: string[] = [];
  const runtime = new ToolRuntime({
    policy: {
      evaluate(invocation) {
        digests.push(invocation.evidenceDigest);
        return { allow: true };
      },
    },
  });

  runtime.registry.register({
    name: "engineering.rename",
    description: "Rename a project",
    risk: "L2",
    effect: "engineering-write",
    validateInput(input) {
      const value = input as { name?: unknown };
      if (typeof value.name !== "string") throw new Error("name is required");
      return { name: value.name.trim() };
    },
    execute() {
      return null;
    },
  });

  await runtime.execute({ id: "call-a", name: "engineering.rename", input: { name: "A" } });
  await runtime.execute({ id: "call-b", name: "engineering.rename", input: { name: "B" } });

  assert.equal(digests.length, 2);
  assert.notEqual(digests[0], digests[1]);
});
