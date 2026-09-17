import assert from "node:assert/strict";
import test from "node:test";

import { PolicyEngine } from "../packages/policy/src/index.ts";
import { ValidationPipeline } from "../packages/validation/src/index.ts";

test("PolicyEngine validates registration, ordering, defaults and provider failure", async () => {
  const engine = new PolicyEngine({ defaultEffect: "allow" });
  assert.throws(() => engine.register({ id: "", evaluate: () => undefined }), /id must not be empty/);

  const calls: string[] = [];
  engine.register({ id: "late", order: 20, evaluate: () => { calls.push("late"); return undefined; } });
  engine.register({ id: "early", order: 10, evaluate: () => { calls.push("early"); return undefined; } });
  assert.throws(() => engine.register({ id: "early", evaluate: () => undefined }), /already registered/);
  assert.deepEqual(engine.list().map((provider) => provider.id), ["early", "late"]);

  const defaultDecision = await engine.evaluate({ action: "inspect" });
  assert.equal(defaultDecision.effect, "allow");
  assert.equal(defaultDecision.reason, undefined);
  assert.deepEqual(calls, ["early", "late"]);
  assert.equal(engine.unregister("missing"), false);
  assert.equal(engine.unregister("early"), true);

  engine.register({ id: "broken", order: 0, evaluate() { throw "boom"; } });
  const failed = await engine.evaluate({ action: "inspect" });
  assert.equal(failed.effect, "deny");
  assert.match(failed.reason ?? "", /Policy provider broken failed: boom/);
  assert.deepEqual(failed.matchedRules, ["broken"]);
});

test("PolicyEngine composes deny-overrides, approval and obligations", async () => {
  const denyEngine = new PolicyEngine();
  denyEngine.register({
    id: "allow-first",
    evaluate: () => ({
      effect: "allow",
      matchedRules: ["allow-rule"],
      obligations: [{ type: "allow-obligation" }],
    }),
  });
  denyEngine.register({
    id: "deny-second",
    evaluate: () => ({
      effect: "deny",
      reason: "blocked",
      matchedRules: ["deny-rule"],
      obligations: [{ type: "deny-obligation" }],
    }),
  });
  const denied = await denyEngine.evaluate({ action: "write" });
  assert.equal(denied.effect, "deny");
  assert.equal(denied.reason, "blocked");
  assert.deepEqual(denied.matchedRules, ["deny-second", "deny-rule"]);
  assert.deepEqual(denied.obligations, [{ type: "deny-obligation" }]);

  const approvalEngine = new PolicyEngine();
  approvalEngine.register({
    id: "allow",
    evaluate: () => ({ effect: "allow", obligations: [{ type: "audit" }] }),
  });
  approvalEngine.register({
    id: "approval",
    evaluate: () => ({ effect: "require-approval", matchedRules: ["r1"] }),
  });
  const approval = await approvalEngine.evaluate({ action: "write" });
  assert.equal(approval.effect, "require-approval");
  assert.deepEqual(approval.matchedRules, ["allow", "approval", "r1"]);
  assert.deepEqual(approval.obligations, [{ type: "audit" }]);

  const defaultDeny = await new PolicyEngine().evaluate({ action: "unknown" });
  assert.equal(defaultDeny.effect, "deny");
  assert.equal(defaultDeny.reason, "No policy rule allowed the operation");
});

test("ValidationPipeline validates registration and provider-scoped ordering", () => {
  const pipeline = new ValidationPipeline<number>();
  assert.throws(() => pipeline.register({ id: "", validate: () => [] }), /id must not be empty/);

  const global = { id: "same", order: 20, validate: () => [] };
  const provider = { id: "same", providerId: "a", order: 10, validate: () => [] };
  const disposeGlobal = pipeline.register(global);
  const disposeProvider = pipeline.register(provider);
  assert.throws(() => pipeline.register(global), /already registered/);

  assert.deepEqual(pipeline.list().map((validator) => validator.providerId ?? "global"), ["global"]);
  assert.deepEqual(pipeline.list({ providerIds: ["a"] }).map((validator) => validator.providerId ?? "global"), ["a", "global"]);
  assert.equal(pipeline.unregister("missing"), false);
  assert.equal(pipeline.unregister("same", "a"), true);

  disposeProvider();
  disposeGlobal();
  assert.equal(pipeline.list().length, 0);
});

test("ValidationPipeline covers stage, supports, cancellation, errors and fail-fast branches", async () => {
  const pipeline = new ValidationPipeline<number>();
  pipeline.register({
    id: "schema",
    stage: "schema",
    supports: (value) => value > 0,
    validate: () => [{ code: "warn", message: "warning", severity: "warning" }],
  });
  pipeline.register({
    id: "domain",
    stage: "domain",
    validate: () => [{ code: "bad", message: "bad", severity: "error", source: "custom-source" }],
  });
  pipeline.register({
    id: "throwing",
    validate() {
      throw "validator exploded";
    },
  });

  const stageOnly = await pipeline.validate(1, {}, ["schema"]);
  assert.equal(stageOnly.valid, false);
  assert.deepEqual(stageOnly.validatorsRun, ["schema", "throwing"]);
  assert.equal(stageOnly.issues[0]?.source, "schema");
  assert.equal(stageOnly.issues[1]?.code, "validator_error");
  assert.equal(stageOnly.issues[1]?.message, "validator exploded");

  const contextStage = await pipeline.validate(1, { stage: "domain" });
  assert.equal(contextStage.issues.some((issue) => issue.source === "custom-source"), true);
  assert.equal(contextStage.validatorsRun.includes("schema"), false);

  const unsupported = await pipeline.validate(0, {}, ["schema"]);
  assert.equal(unsupported.validatorsRun.includes("schema"), false);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await pipeline.validate(1, { signal: controller.signal });
  assert.equal(cancelled.valid, false);
  assert.equal(cancelled.issues[0]?.code, "validation_cancelled");
  assert.equal(cancelled.issues[0]?.source, "schema");

  const failFast = new ValidationPipeline<number>({ failFast: true });
  let secondRan = false;
  failFast.register({ id: "first", validate: () => [{ code: "stop", message: "stop", severity: "error" }] });
  failFast.register({ id: "second", validate: () => { secondRan = true; return []; } });
  const stopped = await failFast.validate(1);
  assert.equal(stopped.valid, false);
  assert.equal(secondRan, false);
  assert.deepEqual(stopped.validatorsRun, ["first"]);
});

test("ValidationPipeline includes global and active-provider validators only", async () => {
  const pipeline = new ValidationPipeline<string>();
  pipeline.register({ id: "global", validate: () => [] });
  pipeline.register({ id: "a", providerId: "a", validate: () => [] });
  pipeline.register({ id: "b", providerId: "b", validate: () => [] });

  const result = await pipeline.validate("value", { providerIds: ["a"] });
  assert.deepEqual(result.validatorsRun, ["global", "a"]);
});
