import assert from "node:assert/strict";
import test from "node:test";

import { AdapterHost } from "../packages/adapter-sdk/src/index.ts";
import {
  ApprovalService,
  CallbackApprovalProvider,
} from "../packages/approval/src/index.ts";
import { ArtifactProviderRegistry } from "../packages/artifacts/src/index.ts";
import { InMemoryEventStore, SessionService, collectEvents, replaySession } from "../packages/events/src/index.ts";
import { createDefaultMcpRiskResolver } from "../packages/mcp/src/index.ts";
import { PolicyEngine } from "../packages/policy/src/index.ts";
import { ToolRuntime } from "../packages/tools/src/index.ts";
import { TransactionRuntime } from "../packages/transactions/src/index.ts";

test("ToolRuntime fails closed for privileged tools without policy", async () => {
  let executed = false;
  const runtime = new ToolRuntime();
  runtime.registry.register({
    name: "plc.project.modify",
    description: "Modify an engineering project",
    risk: "L2",
    effect: "engineering-write",
    execute() {
      executed = true;
      return { changed: true };
    },
  });

  const result = await runtime.execute({
    id: "call-1",
    name: "plc.project.modify",
    input: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "policy_unavailable");
  assert.equal(executed, false);
});

test("ToolRuntime permits low-risk tool execution without policy", async () => {
  const runtime = new ToolRuntime();
  runtime.registry.register({
    name: "project.inspect",
    description: "Read project metadata",
    risk: "L0",
    effect: "read",
    execute() {
      return { version: 1 };
    },
  });

  const result = await runtime.execute({
    id: "call-2",
    name: "project.inspect",
    input: {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { version: 1 });
});

test("PolicyEngine uses deny-overrides composition", async () => {
  const policy = new PolicyEngine();
  policy.register({
    id: "allow-engineering",
    evaluate() {
      return { effect: "allow", matchedRules: ["allow-engineering"] };
    },
  });
  policy.register({
    id: "deny-production",
    evaluate() {
      return {
        effect: "deny",
        reason: "Production mutation is blocked",
        matchedRules: ["deny-production"],
      };
    },
  });

  const decision = await policy.evaluate({ action: "transaction.execute" });

  assert.equal(decision.effect, "deny");
  assert.equal(decision.reason, "Production mutation is blocked");
  assert.ok(decision.matchedRules?.includes("deny-production"));
});

test("ApprovalService expires stale requests before calling provider", async () => {
  let called = false;
  const approval = new ApprovalService({
    now: () => "2026-09-16T08:00:00.000Z",
    provider: new CallbackApprovalProvider(() => {
      called = true;
      throw new Error("provider should not be called");
    }),
  });

  const decision = await approval.request({
    id: "approval-1",
    actor: { id: "engineer", type: "human" },
    operation: { action: "deploy" },
    risk: "L3",
    reason: "Deploy project",
    requiredApprovers: [],
    expiresAt: "2026-09-16T07:59:59.000Z",
  });

  assert.equal(decision.decision, "expired");
  assert.equal(called, false);
});

test("TransactionRuntime detects optimistic concurrency conflicts before apply", async () => {
  const artifacts = new ArtifactProviderRegistry();
  artifacts.register({
    id: "mock",
    async get(ref) {
      return { ...ref, version: "2", provider: "mock" };
    },
    async exists() {
      return true;
    },
    async currentVersion() {
      return "2";
    },
  });

  let applied = false;
  const runtime = new TransactionRuntime({
    artifacts,
    allowWithoutPolicy: true,
    executor: {
      id: "mock-executor",
      mode: "atomic",
      apply() {
        applied = true;
        return {};
      },
    },
  });

  const result = await runtime.execute({
    id: "changeset-1",
    protocolVersion: "0.1",
    artifacts: [
      {
        id: "project:1",
        type: "industrial.hmi.project",
        version: "1",
        provider: "mock",
      },
    ],
    operations: [
      {
        id: "op-1",
        op: "update",
        target: "screen:overview",
      },
    ],
  });

  assert.equal(result.state, "conflicted");
  assert.equal(result.error?.code, "version_conflict");
  assert.equal(applied, false);
});

test("Untrusted MCP annotations cannot lower tool risk", () => {
  const classify = createDefaultMcpRiskResolver();
  const descriptor = {
    name: "read_plc_tag",
    description: "Read tag",
    annotations: { readOnlyHint: true, idempotentHint: true },
  };

  const untrusted = classify({
    serverId: "remote",
    trustedServer: false,
    descriptor,
  });
  const trusted = classify({
    serverId: "trusted",
    trustedServer: true,
    descriptor,
  });

  assert.equal(untrusted.risk, "L2");
  assert.equal(untrusted.effect, "engineering-write");
  assert.equal(trusted.risk, "L0");
  assert.equal(trusted.effect, "read");
});

test("EventStore preserves append order and replays session state", async () => {
  let clock = 0;
  const store = new InMemoryEventStore();
  const sessions = new SessionService({
    store,
    idFactory: () => "session-1",
    eventIdFactory: () => `event-${++clock}`,
    now: () => `2026-09-16T08:00:0${clock}.000Z`,
  });

  await sessions.create({ actor: { id: "operator", type: "human" } });
  await sessions.append("session-1", {
    type: "transaction.started",
    transactionId: "tx-1",
    correlationId: "corr-1",
    data: { changeSetId: "cs-1" },
  });
  await sessions.complete("session-1", { result: "ok" });

  const events = await collectEvents(store, { sessionId: "session-1" });
  const replayed = await replaySession(store, "session-1");

  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(events.map((event) => event.type), [
    "session.created",
    "transaction.started",
    "session.completed",
  ]);
  assert.equal(replayed?.status, "completed");
});

test("AdapterHost cleans up partial registrations after mount failure", async () => {
  const host = new AdapterHost();

  const adapter = {
    id: "cleanup-adapter",
    version: "0.1.0",
    async capabilities() {
      return {
        adapterId: "cleanup-adapter",
        adapterVersion: "0.1.0",
        capabilities: {},
      };
    },
    tools() {
      return [
        {
          name: "temporary.tool",
          description: "Registered before collision",
          risk: "L0" as const,
          effect: "read" as const,
          execute() {
            return null;
          },
        },
        {
          name: "temporary.tool",
          description: "Duplicate semantic Tool from the same Adapter provider",
          risk: "L0" as const,
          effect: "read" as const,
          execute() {
            return null;
          },
        },
      ];
    },
  };

  await assert.rejects(
    () => host.mount(adapter),
    /Tool provider already registered/,
  );
  assert.equal(host.tools.has("temporary.tool"), false);
  assert.equal(host.registry.has("cleanup-adapter"), false);
});
