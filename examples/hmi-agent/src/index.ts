import { AgentLoop, type AgentModelProvider } from "@axrail/agent";
import {
  AdapterRegistry,
  type AxrailAdapter,
} from "@axrail/adapter-sdk";
import {
  ApprovalService,
  CallbackApprovalProvider,
} from "@axrail/approval";
import {
  ArtifactProviderRegistry,
  type Artifact,
  type ArtifactProvider,
  type ArtifactRef,
} from "@axrail/artifacts";
import type { ChangeSet } from "@axrail/changesets";
import {
  HMI_CAPABILITIES,
  createHmiCapabilityManifest,
  createHmiTools,
  exactHmiCapabilities,
  hmiProjectRef,
} from "@axrail/hmi-adapter-kit";
import { PolicyEngine } from "@axrail/policy";
import { ToolRuntime } from "@axrail/tools";
import {
  TransactionRuntime,
  createTransactionApprovalProvider,
  createTransactionPolicyEvaluator,
  createTransactionValidator,
  type TransactionExecutor,
} from "@axrail/transactions";
import { ValidationPipeline, type Validator } from "@axrail/validation";

interface MockHmiProject {
  readonly id: string;
  version: number;
  screens: string[];
}

const project: MockHmiProject = {
  id: "project:demo-hmi",
  version: 1,
  screens: [],
};

const artifactProvider: ArtifactProvider = {
  id: "mock-hmi",
  async get(ref): Promise<Artifact> {
    assertProject(ref);
    return {
      ...ref,
      version: String(project.version),
      provider: "mock-hmi",
      metadata: { screenCount: project.screens.length },
      capabilities: [HMI_CAPABILITIES.SCREEN_CREATE],
    };
  },
  async exists(ref): Promise<boolean> {
    return ref.id === project.id;
  },
  async currentVersion(ref): Promise<string | undefined> {
    assertProject(ref);
    return String(project.version);
  },
};

const artifacts = new ArtifactProviderRegistry();
artifacts.register(artifactProvider);

const policy = new PolicyEngine();
policy.register({
  id: "engineering-change-approval",
  evaluate(input) {
    if (input.action !== "transaction.execute") return undefined;
    if (input.risk === "L0" || input.risk === "L1") return { effect: "allow" };
    return {
      effect: "require-approval",
      reason: "Engineering changes require explicit approval in this example",
      matchedRules: ["engineering-change-approval"],
    };
  },
});

const approval = new ApprovalService({
  provider: new CallbackApprovalProvider(async (request) => ({
    requestId: request.id,
    decision: "approved",
    approver: {
      id: "demo-engineer",
      type: "human",
      roles: ["controls-engineer"],
      displayName: "Demo Controls Engineer",
    },
    reason: "Auto-approved by the example provider",
    decidedAt: new Date().toISOString(),
  })),
});

const validation = new ValidationPipeline<ChangeSet>();
const screenValidator: Validator<ChangeSet> = {
  id: "mock-hmi.screen-name",
  stage: "domain",
  validate(changeSet) {
    const issues = [];
    for (const operation of changeSet.operations) {
      if (operation.op !== "create" || operation.target !== "screen") continue;
      const name = readScreenName(operation.value);
      if (!name) {
        issues.push({
          code: "screen_name_required",
          message: "A created HMI screen requires a non-empty name",
          severity: "error" as const,
        });
      }
      if (name && project.screens.includes(name)) {
        issues.push({
          code: "screen_name_duplicate",
          message: `HMI screen already exists: ${name}`,
          severity: "error" as const,
        });
      }
    }
    return issues;
  },
};
validation.register(screenValidator);

let stagedScreen: string | undefined;
const executor: TransactionExecutor = {
  id: "mock-hmi.executor",
  mode: "atomic",
  apply(transaction) {
    stagedScreen = transaction.changeSet.operations
      .filter((operation) => operation.op === "create" && operation.target === "screen")
      .map((operation) => readScreenName(operation.value))
      .find((name): name is string => Boolean(name));

    if (!stagedScreen) throw new Error("No screen create operation was found");
    return { metadata: { stagedScreen } };
  },
  verify() {
    return Boolean(stagedScreen) && !project.screens.includes(stagedScreen!);
  },
  commit() {
    if (!stagedScreen) throw new Error("No staged screen to commit");
    project.screens.push(stagedScreen);
    project.version += 1;
    stagedScreen = undefined;
  },
  async rollback() {
    stagedScreen = undefined;
    return { complete: true };
  },
};

const transactions = new TransactionRuntime({
  executor,
  artifacts,
  policy: createTransactionPolicyEvaluator(policy),
  approval: createTransactionApprovalProvider(approval, {
    requiredApprovers: [{ role: "controls-engineer", count: 1 }],
  }),
  validate: createTransactionValidator(validation),
});

const hmiTools = createHmiTools({
  async screenCreate(input, context) {
    assertProjectId(input.projectId);

    const version = String(project.version);
    const changeSet: ChangeSet = {
      id: `changeset:create-screen:${input.name}`,
      protocolVersion: "0.1",
      artifacts: [
        hmiProjectRef(project.id, {
          version,
          provider: "mock-hmi",
        }),
      ],
      actor: context.actorId
        ? { id: context.actorId, type: "user" }
        : undefined,
      reason: `Create HMI screen ${input.name}`,
      operations: [
        {
          id: "create-screen",
          op: "create",
          target: "screen",
          value: {
            name: input.name,
            template: input.template,
          },
          risk: { level: "L2", reasons: ["Modifies an engineering artifact"] },
        },
      ],
    };

    const result = await transactions.execute(changeSet, {
      actor: changeSet.actor,
      environment: "design",
      adapterIds: ["mock-hmi"],
    });

    if (result.state !== "committed") {
      throw new Error(
        `HMI transaction did not commit: ${result.state} (${result.error?.message ?? "unknown error"})`,
      );
    }

    return {
      projectId: project.id,
      screen: input.name,
      projectVersion: project.version,
    };
  },
});

const adapter: AxrailAdapter = {
  id: "mock-hmi",
  version: "0.1.0",
  async capabilities() {
    return createHmiCapabilityManifest({
      adapterId: "mock-hmi",
      adapterVersion: "0.1.0",
      protocolVersion: "0.1",
      target: { vendor: "Axrail", product: "Mock HMI" },
      support: exactHmiCapabilities(
        HMI_CAPABILITIES.PROJECT_ARTIFACT,
        HMI_CAPABILITIES.SCREEN_CREATE,
      ),
      extraCapabilities: {
        "transaction.atomic": { level: "exact" },
      },
    });
  },
  tools: () => hmiTools,
  artifacts: () => artifactProvider,
};

const adapters = new AdapterRegistry();
adapters.register(adapter);
await adapters.initialize(adapter.id, { environment: "design" });
await adapters.start(adapter.id, { environment: "design" });

const toolRuntime = new ToolRuntime({
  // The tool boundary permits this L2 call to enter its own governed
  // transaction. The transaction independently evaluates engineering policy,
  // validation, and approval before committing the artifact.
  policy: {
    evaluate(invocation) {
      return invocation.toolName === HMI_CAPABILITIES.SCREEN_CREATE
        ? { allow: true }
        : { allow: false, reason: "Tool is not allowed in this example" };
    },
  },
});
for (const tool of adapter.tools?.() ?? []) toolRuntime.registry.register(tool);

const model: AgentModelProvider = {
  id: "deterministic-demo-model",
  async complete(request) {
    const last = request.messages.at(-1);
    if (last?.role === "tool") {
      return {
        content: `The governed HMI change completed. Tool result: ${last.content}`,
        stopReason: "completed",
      };
    }

    return {
      toolCalls: [
        {
          id: "call:create-robot-overview",
          name: HMI_CAPABILITIES.SCREEN_CREATE,
          input: {
            projectId: project.id,
            name: "Robot Overview",
          },
        },
      ],
      stopReason: "tool_calls",
    };
  },
};

const agent = new AgentLoop({
  model,
  tools: toolRuntime,
  systemPrompt:
    "You are an industrial engineering assistant. Use Axrail tools; never bypass policy, validation, approval, or transactions.",
});

const result = await agent.run("Create a robot monitoring screen", {
  actorId: "demo-user",
});

console.log(result.content);
console.log("Committed project:", project);

function assertProject(ref: ArtifactRef): void {
  if (ref.id !== project.id) throw new Error(`Unknown mock HMI artifact: ${ref.id}`);
}

function assertProjectId(projectId: string): void {
  if (projectId !== project.id) {
    throw new Error(`Unknown mock HMI project: ${projectId}`);
  }
}

function readScreenName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const name = (value as { name?: unknown }).name;
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  return trimmed || undefined;
}
