import assert from "node:assert/strict";
import test from "node:test";

import { ApprovalService, CallbackApprovalProvider } from "../packages/approval/src/index.ts";
import { collectEvents } from "../packages/events/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";
import { hmiComponentSelection } from "../packages/hmi-adapter-kit/src/index.ts";

/**
 * Mock-only HMI version-gate test. Simulates an engineering project revision
 * between preview/approval and application; no device or vendor API involved.
 */
for (const concurrentEdit of [false, true] as const) {
  test(`HMI approval remains evidence-bound when project version changes: ${concurrentEdit}`, async () => {
    const selection = hmiComponentSelection({
      selectionId: "selection-temperature",
      providerId: "versioned-hmi",
      projectId: "project:demo",
      screenId: "screen:overview",
      componentId: "component:temperature",
    });
    let projectVersion = "7";
    let applied = 0;
    let approved = 0;
    let approvedVersions: Record<string, string> | undefined;

    const approval = new ApprovalService({
      provider: new CallbackApprovalProvider((request) => {
        approved += 1;
        assert.equal(request.evidence?.changeSetId, "cs-versioned-temperature");
        assert.ok(request.evidenceDigest);
        approvedVersions = request.evidence?.artifactVersions;
        if (concurrentEdit) projectVersion = "8"; // An external editor commits during approval.
        return {
          requestId: request.id,
          decision: "approved",
          decidedAt: "2026-11-16T00:00:00.000Z",
          approver: { id: "controls-engineer", type: "human", roles: ["engineer"] },
          evidenceDigest: request.evidenceDigest,
        };
      }),
      now: () => "2026-11-16T00:00:00.000Z",
    });
    const harness = new HarnessRuntime({
      approval,
      environment: "engineering",
      auditPolicy: "required_before_effect",
      now: () => "2026-11-16T00:00:00.000Z",
    });
    await harness.mountAdapter({
      id: "versioned-hmi",
      version: "1.0.0",
      async capabilities() {
        return { adapterId: "versioned-hmi", adapterVersion: "1.0.0", capabilities: {} };
      },
      artifacts() {
        return {
          id: "versioned-hmi",
          async get(ref) { return { ...ref, version: projectVersion }; },
          async exists() { return true; },
          async currentVersion() { return projectVersion; },
        };
      },
      policies() {
        return [{
          id: "engineering-review",
          evaluate(input) {
            assert.equal(input.adapterId, "versioned-hmi");
            return { effect: "require-approval" as const, reason: "L2 engineering edit" };
          },
        }];
      },
    });

    // Explicit version evidence binds the selection target to project revision 7.
    const result = await harness.executeChangeSet({
      id: "cs-versioned-temperature",
      protocolVersion: "0.1",
      artifacts: [{
        id: selection.projectId,
        type: "industrial.hmi.project",
        provider: selection.providerId,
        version: "7",
      }],
      operations: [{
        op: "update",
        target: selection.targets[0]!.targetId,
        value: { alarmThresholdCelsius: 95 },
        risk: { level: "L2" },
      }],
    }, {
      executor: {
        id: "versioned-executor",
        providerId: "versioned-hmi",
        mode: "atomic",
        apply() { applied += 1; return {}; },
        verify() { return true; },
        commit() {},
      },
      requiredApprovers: [{ role: "engineer", count: 1 }],
      actor: { id: "operator", type: "human" },
      correlationId: "hmi-project-revision-gate",
    });

    assert.equal(approved, 1);
    assert.deepEqual(Object.values(approvedVersions ?? {}), ["7"]);
    const events = await collectEvents(harness.events, {
      correlationId: "hmi-project-revision-gate",
    });
    if (concurrentEdit) {
      assert.equal(result.state, "conflicted");
      assert.equal(result.error?.code, "version_conflict");
      assert.equal(applied, 0);
      assert.ok(events.some((event) => event.type === "transaction.conflicted"));
      assert.equal(events.some((event) => event.type === "audit.effect.checkpoint"), false);
    } else {
      assert.equal(result.state, "committed");
      assert.equal(applied, 1);
      assert.ok(result.approvedEvidenceDigest);
      assert.ok(events.some((event) => event.type === "audit.effect.checkpoint"));
      assert.ok(events.some((event) => event.type === "transaction.committed"));
    }
  });
}
