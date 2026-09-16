import type { AgentModelProvider } from "@axrail/agent";
import type { AxrailAdapter } from "@axrail/adapter-sdk";
import {
  ApprovalService,
  CallbackApprovalProvider,
} from "@axrail/approval";
import { HarnessRuntime } from "@axrail/harness";

interface DemoProject {
  id: string;
  name: string;
}

export interface HelloAgentExampleResult {
  readonly status: string;
  readonly content?: string;
  readonly project: Readonly<DemoProject>;
  readonly eventTypes: readonly string[];
}

export async function runHelloAgentExample(): Promise<HelloAgentExampleResult> {
  const project: DemoProject = {
    id: "demo-project",
    name: "Original Project",
  };

  const approval = new ApprovalService({
    provider: new CallbackApprovalProvider((request) => ({
      requestId: request.id,
      decision: "approved",
      approver: {
        id: "demo-engineer",
        type: "human",
        roles: ["engineer"],
      },
      reason: "Approved by deterministic hello-agent example",
      decidedAt: new Date().toISOString(),
    })),
  });

  const harness = new HarnessRuntime({
    approval,
    environment: "development",
  });

  const adapter: AxrailAdapter = {
    id: "hello-demo",
    version: "0.1.0",
    async capabilities() {
      return {
        adapterId: "hello-demo",
        adapterVersion: "0.1.0",
        capabilities: {
          "demo.project.inspect": { level: "exact" },
          "demo.project.rename": { level: "exact" },
        },
      };
    },
    tools() {
      return [
        {
          name: "demo.project.inspect",
          description: "Inspect the deterministic example project.",
          risk: "L0",
          effect: "read",
          idempotent: true,
          execute() {
            return { ...project };
          },
        },
        {
          name: "demo.project.rename",
          description: "Rename the deterministic example project.",
          risk: "L2",
          effect: "engineering-write",
          validateInput(input) {
            if (!input || typeof input !== "object") {
              throw new Error("Expected rename input object");
            }
            const name = (input as { name?: unknown }).name;
            if (typeof name !== "string" || !name.trim()) {
              throw new Error("Expected a non-empty project name");
            }
            return { name: name.trim() };
          },
          execute(input) {
            const name = (input as { name: string }).name;
            project.name = name;
            return { ...project };
          },
        },
      ];
    },
    policies() {
      return [
        {
          id: "hello-example-policy",
          evaluate(input) {
            if (input.action === "demo.project.inspect") {
              return { effect: "allow" };
            }
            if (input.action === "demo.project.rename") {
              return {
                effect: "require-approval",
                reason: "Engineering writes require approval in the hello example",
              };
            }
            return { effect: "deny", reason: "Unknown demo action" };
          },
        },
      ];
    },
  };

  await harness.mountAdapter(adapter);

  let turn = 0;
  const model: AgentModelProvider = {
    id: "deterministic-hello-model",
    async complete() {
      turn += 1;
      if (turn === 1) {
        return {
          toolCalls: [
            {
              id: "inspect-1",
              name: "demo.project.inspect",
              input: {},
            },
          ],
          stopReason: "tool_calls",
        };
      }
      if (turn === 2) {
        return {
          toolCalls: [
            {
              id: "rename-1",
              name: "demo.project.rename",
              input: { name: "Axrail Demo Project" },
            },
          ],
          stopReason: "tool_calls",
        };
      }
      return {
        content: "Inspected the project and completed the governed rename.",
        stopReason: "completed",
      };
    },
  };

  const agent = harness.createAgent({
    model,
    systemPrompt:
      "You are a deterministic Axrail example Agent. Use registered tools and respect governance.",
  });

  const result = await agent.run("Inspect the project, then rename it.", {
    actorId: "demo-user",
    metadata: { correlationId: "hello-example" },
  });

  const eventTypes: string[] = [];
  for await (const event of harness.events.read({ sessionId: result.sessionId })) {
    eventTypes.push(event.type);
  }

  return {
    status: result.status,
    content: result.content,
    project: { ...project },
    eventTypes,
  };
}
