import assert from "node:assert/strict";
import test from "node:test";

import { ApprovalService, CallbackApprovalProvider } from "../packages/approval/src/index.ts";
import { collectEvents } from "../packages/events/src/index.ts";
import { HarnessRuntime } from "../packages/harness/src/index.ts";
import {
  createHmiTools,
  hmiComponentSelection,
  hmiSelectionContextFragment,
} from "../packages/hmi-adapter-kit/src/index.ts";

/**
 * Mock-only acceptance fixture for the HMI path. Selection and preview are
 * application-owned and intentionally do not constitute transaction approval.
 */
for (const decision of ["approved", "rejected"] as const) {
  test(`mock HMI selection, preview and governed transaction: ${decision}`, async () => {
    const selection = hmiComponentSelection({
      selectionId: "sel-1",
      providerId: "fixture-hmi",
      projectId: "project:demo",
      screenId: "screen:overview",
      componentId: "component:temperature",
      timestamp: "2026-11-16T00:00:00.000Z",
    });
    const fragment = hmiSelectionContextFragment(selection);
    assert.equal(fragment.providerId, "fixture-hmi");
    assert.equal(selection.targets[0]?.targetId, "component:temperature");

    const steps: string[] = [];
    let effectCount = 0;
    const approval = new ApprovalService({
      provider: new CallbackApprovalProvider((request) => {
        steps.push("approval");
        assert.equal(request.evidence?.changeSetId, "cs-hmi-temperature");
        assert.ok(request.evidenceDigest);
        return {
          requestId: request.id,
          decision,
          decidedAt: "2026-11-16T00:00:00.000Z",
          evidenceDigest: request.evidenceDigest,
          approver: { id: "controls-engineer", type: "human", roles: ["engineer"] },
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
      id: "fixture-hmi",
      version: "1.0.0",
      async capabilities() {
        return { adapterId: "fixture-hmi", adapterVersion: "1.0.0", capabilities: {} };
      },
      tools() {
        return createHmiTools({
          preview(input) {
            steps.push("preview");
            assert.equal(input.projectId, selection.projectId);
            assert.equal(input.screenId, selection.screenId);
            return { previewId: "preview-1" };
          },
        });
      },
      policies() {
        return [{
          id: "fixture-hmi-policy",
          evaluate(input) {
            steps.push("policy");
            assert.equal(input.adapterId, "fixture-hmi");
            return input.action === "transaction.execute"
              ? { effect: "require-approval" as const, reason: "Engineering review" }
              : { effect: "allow" as const };
          },
        }];
      },
      validators() {
        return [{
          id: "fixture-target-validator",
          validate(_change, context) {
            steps.push("validate");
            assert.deepEqual(context.providerIds, ["fixture-hmi"]);
            return [];
          },
        }];
      },
    });

    // Preview runs as a separately governed L1 Tool, not as a privileged mutation.
    const preview = await harness.tools.execute(
      { id: "preview-call", name: "hmi.preview", providerId: "fixture-hmi",
        input: { projectId: selection.projectId, screenId: selection.screenId } },
    );
    assert.equal(preview.ok, true);

    const changeSet = {
      id: "cs-hmi-temperature",
      protocolVersion: "0.1",
      artifacts: [],
      operations: [{
        op: "update" as const,
        target: selection.targets[0]!.targetId,
        value: { alarmThresholdCelsius: 95 },
        risk: { level: "L2" as const },
      }],
      reason: "Operator-selected HMI component alarm threshold adjustment",
    };
    const result = await harness.executeChangeSet(changeSet, {
      executor: {
        id: "fixture-hmi-executor",
        providerId: "fixture-hmi",
        mode: "atomic",
        apply() {
          steps.push("apply");
          effectCount += 1;
          return {};
        },
        verify() {
          steps.push("verify");
          return true;
        },
        commit() {
          steps.push("commit");
        },
      },
      requiredApprovers: [{ role: "engineer", count: 1 }],
      actor: { id: "operator", type: "human" },
      correlationId: "hmi-beta-fixture",
    });

    assert.ok(steps.indexOf("preview") < steps.lastIndexOf("approval"));
    assert.ok(steps.indexOf("validate") < steps.lastIndexOf("approval"));
    if (decision === "approved") {
      assert.equal(result.state, "committed");
      assert.ok(result.approvedEvidenceDigest);
      assert.equal(effectCount, 1);
      assert.ok(steps.indexOf("approval") < steps.indexOf("apply"));
      assert.deepEqual(steps.slice(-3), ["apply", "verify", "commit"]);
    } else {
      assert.equal(result.state, "rejected");
      assert.equal(result.error?.code, "approval_denied");
      assert.equal(effectCount, 0);
      assert.equal(steps.includes("apply"), false);
    }

    const events = await collectEvents(harness.events, { correlationId: "hmi-beta-fixture" });
    assert.ok(events.some((event) => event.type === "transaction.preparing"));
    assert.ok(events.some((event) => event.type ===
      (decision === "approved" ? "transaction.committed" : "transaction.rejected")));
  });
}
