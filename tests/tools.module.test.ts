import assert from "node:assert/strict";
import test from "node:test";

import {
  ToolRegistry,
  ToolResolutionError,
  ToolRuntime,
  createToolInvocationEnvelope,
  digestToolInvocationEvidence,
  type ToolDefinition,
} from "../packages/tools/src/index.ts";

function tool(name: string, providerId?: string, overrides: Partial<ToolDefinition<any, any>> = {}): ToolDefinition<any, any> {
  return {
    name,
    providerId,
    description: name,
    risk: "L0",
    effect: "read",
    execute: (input) => input,
    ...overrides,
  };
}

test("ToolRegistry covers registration, fallback, scoped resolution and disposal", () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.register(tool("")), /name must not be empty/);
  const disposeDefault = registry.register(tool("x"));
  assert.throws(() => registry.register(tool("x")), /already registered/);
  const disposeA = registry.register(tool("x", "a"));
  const disposeB = registry.register(tool("x", "b"));

  assert.equal(registry.has("missing"), false);
  assert.equal(registry.has("x"), true);
  assert.equal(registry.has("x", "a"), true);
  assert.equal(registry.has("x", "unknown"), true); // default fallback
  assert.equal(registry.get("x", { providerId: "a" }).providerId, "a");
  assert.equal(registry.get("x", { providerId: "unknown" }).providerId, undefined);
  assert.throws(() => registry.resolve("missing"), (error: unknown) => (error as ToolResolutionError).code === "tool_not_found");
  assert.throws(() => registry.resolve("x"), (error: unknown) => (error as ToolResolutionError).code === "tool_provider_ambiguous");
  assert.throws(
    () => registry.resolve("x", { providerIds: ["a"] }),
    (error: unknown) => (error as ToolResolutionError).code === "tool_provider_ambiguous",
  );

  disposeDefault();
  assert.equal(registry.resolve("x", { providerIds: ["a"] }).providerId, "a");
  assert.throws(() => registry.resolve("x", { providerIds: ["missing"] }), (error: unknown) => (error as ToolResolutionError).code === "tool_provider_unavailable");
  assert.throws(() => registry.resolve("x", { providerId: "missing" }), /available providers: a, b/);
  assert.deepEqual(registry.providers("x"), ["a", "b"]);
  assert.deepEqual(registry.providers("missing"), []);

  registry.register(tool("a-tool", "a"));
  assert.deepEqual(registry.list({ providerIds: ["a"] }).map((entry) => entry.name), ["a-tool", "x"]);

  disposeA();
  disposeA();
  disposeB();
  assert.equal(registry.has("x"), false);
});

test("Tool invocation envelope snapshots description/context and rejects unsupported evidence values", async () => {
  const described = tool("describe", "provider", {
    version: "1",
    risk: "L2",
    effect: "engineering-write",
    async describeInvocation(input) {
      return { target: `target:${input.id}`, artifactRefs: ["a"], metadata: { z: 1, a: 2 } };
    },
  });
  const envelope = await createToolInvocationEnvelope(
    described,
    { id: "call", name: "describe", input: {} },
    { id: "1", nested: { value: true } },
    { sessionId: "s", transactionId: "t", actorId: "u", metadata: { environment: "design", x: 1 } },
  );
  assert.equal(envelope.target, "target:1");
  assert.equal(envelope.context.environment, "design");
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.input), true);
  assert.match(envelope.evidenceDigest, /^sha256:/);
  const { evidenceDigest: _ignored, ...withoutDigest } = envelope;
  assert.equal(await digestToolInvocationEvidence(withoutDigest), envelope.evidenceDigest);

  const plain = await createToolInvocationEnvelope(
    tool("plain"),
    { id: "plain-call", name: "plain", input: 1 },
    [1, null, true],
    { metadata: { environment: 3 } },
  );
  assert.equal(plain.target, undefined);
  assert.equal(plain.context.environment, undefined);

  const noDescription = await createToolInvocationEnvelope(
    tool("none", undefined, { describeInvocation: () => undefined }),
    { id: "c", name: "none", input: {} },
    {},
    {},
  );
  assert.equal(noDescription.descriptionMetadata, undefined);

  for (const invalid of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    { bad: () => 1 },
    { bad: Symbol("x") },
    { bad: 1n },
    undefined,
  ]) {
    await assert.rejects(
      createToolInvocationEnvelope(tool("bad"), { id: "bad", name: "bad", input: invalid }, invalid, {}),
      /non-finite|Unsupported value/,
    );
  }
});

test("ToolRuntime covers resolution, input, cancellation, policy and approval failure branches", async () => {
  let runtime = new ToolRuntime();
  let result = await runtime.execute({ id: "1", name: "missing", input: {} });
  assert.equal(result.error?.code, "tool_not_found");

  runtime.registry.register(tool("invalid", undefined, { validateInput() { throw "bad input"; } }));
  result = await runtime.execute({ id: "2", name: "invalid", input: {} });
  assert.equal(result.error?.code, "invalid_input");

  runtime.registry.register(tool("cancelled"));
  const preCancelled = new AbortController();
  preCancelled.abort();
  result = await runtime.execute({ id: "3", name: "cancelled", input: {} }, { signal: preCancelled.signal });
  assert.equal(result.error?.code, "cancelled");

  runtime = new ToolRuntime({ policy: { evaluate: () => ({ allow: false }) } });
  runtime.registry.register(tool("denied", undefined, { risk: "L2", effect: "engineering-write" }));
  result = await runtime.execute({ id: "4", name: "denied", input: {} });
  assert.equal(result.error?.code, "policy_denied");
  assert.equal(result.error?.message, "Tool execution denied by policy");

  runtime = new ToolRuntime({ policy: { evaluate: () => ({ allow: true, obligations: [{ type: "require-environment", parameters: { environment: "prod" } }] }) } });
  runtime.registry.register(tool("environment", undefined, { risk: "L2", effect: "engineering-write" }));
  result = await runtime.execute({ id: "5", name: "environment", input: {} }, { metadata: { environment: "dev" } });
  assert.equal(result.error?.code, "policy_obligation_unsatisfied");
  assert.match(result.error?.message ?? "", /expected prod/);

  runtime = new ToolRuntime({ policy: { evaluate: () => ({ allow: true }) } });
  runtime.registry.register(tool("l5", undefined, { risk: "L5", effect: "safety-critical" }));
  result = await runtime.execute({ id: "6", name: "l5", input: {} });
  assert.equal(result.error?.code, "transaction_required");

  runtime = new ToolRuntime({ policy: { evaluate: () => ({ allow: true, requireApproval: true }) } });
  runtime.registry.register(tool("needs-approval", undefined, { risk: "L2", effect: "engineering-write" }));
  result = await runtime.execute({ id: "7", name: "needs-approval", input: {} });
  assert.equal(result.error?.code, "approval_unavailable");

  runtime = new ToolRuntime({
    policy: { evaluate: () => ({ allow: true, requireApproval: true }) },
    approval: { approve: () => false },
  });
  runtime.registry.register(tool("approval-denied", undefined, { risk: "L2", effect: "engineering-write" }));
  result = await runtime.execute({ id: "8", name: "approval-denied", input: {} });
  assert.equal(result.error?.code, "approval_denied");
});

test("ToolRuntime covers audit, execution error and mid-flight cancellation branches", async () => {
  let runtime = new ToolRuntime({
    beforeExecute() { throw "audit down"; },
  });
  runtime.registry.register(tool("audit"));
  let result = await runtime.execute({ id: "1", name: "audit", input: {} });
  assert.equal(result.error?.code, "audit_unavailable");
  assert.match(result.error?.message ?? "", /audit down/);

  runtime = new ToolRuntime();
  runtime.registry.register(tool("read-error", undefined, { execute() { throw "boom"; } }));
  result = await runtime.execute({ id: "2", name: "read-error", input: {} });
  assert.equal(result.error?.code, "execution_failed");
  assert.equal((result.error?.details as any).effectUncertain, false);
  assert.equal((result.error?.details as any).retrySafe, true);

  const controller = new AbortController();
  runtime = new ToolRuntime();
  runtime.registry.register(tool("abort", undefined, {
    execute(_input, context) {
      return new Promise((_resolve, reject) => {
        context.signal?.addEventListener("abort", () => reject(new Error("aborted by caller")), { once: true });
        setTimeout(() => controller.abort("stop"), 5);
      });
    },
  }));
  result = await runtime.execute({ id: "3", name: "abort", input: {} }, { signal: controller.signal });
  assert.equal(result.error?.code, "cancelled");
  assert.equal((result.error?.details as any).effectUncertain, false);
});

test("ToolRuntime succeeds with satisfied obligations and ignores observational event failures", async () => {
  const runtime = new ToolRuntime({
    policy: {
      evaluate: () => ({
        allow: true,
        obligations: [
          { type: "require-transaction" },
          { type: "require-environment", parameters: { value: "design" } },
        ],
      }),
    },
    onEvent() { throw new Error("telemetry unavailable"); },
  });
  runtime.registry.register(tool("ok", "p", { risk: "L2", effect: "engineering-write", execute: (_input, context) => context.providerIds }));
  const result = await runtime.execute(
    { id: "1", name: "ok", providerId: "p", input: {} },
    { transactionId: "tx", metadata: { environment: "design", correlationId: "corr" } },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, ["p"]);
});
