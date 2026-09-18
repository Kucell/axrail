# @axrail/interaction-sdk

Headless AI interaction core and typed plugin SDK for Axrail-powered engineering applications.

> Status: **post-RC / pre-stable on Axrail `main`**. This package is not part of the published npm `0.1.0-rc.1` artifact.

## Purpose

Third-party HMI, SCADA, CAD/CAE, robot, MES and engineering applications can keep their own UI while reusing one Axrail-owned interaction pipeline:

```text
Existing AI Chat / Canvas
          ↓
   InteractionRuntime
    ├─ explicit Selection
    ├─ Adapter Context
    ├─ plugin Context
    ├─ context budget
    ├─ normalized events
    └─ PluginHost
          ↓
     HarnessRuntime
          ↓
 Agent / governed Tools
          ↓
ChangeSet / Transaction
          ↓
       Adapter
```

The plugin model is intentionally scoped to the interaction layer.

Interaction plugins do **not** receive direct Policy, Approval, TransactionRuntime or privileged mutation handles from this SDK.

## Minimal runtime

```ts
import { InteractionRuntime } from "@axrail/interaction-sdk";

const interaction = new InteractionRuntime({
  harness,
  model,
  systemPrompt: "You are an engineering assistant.",
});

interaction.subscribe((event) => {
  switch (event.type) {
    case "interaction.context.collected":
      // update UI status
      break;

    case "interaction.agent.event":
      // bridge Agent/Tool lifecycle into the product UI
      break;

    case "interaction.turn.completed":
      // refresh the engineering view when appropriate
      break;

    case "interaction.turn.failed":
      // show an explicit failure state
      break;
  }
});

const result = await interaction.send({
  message: "Align the selected pumps horizontally",
  providerId: "vendor-hmi",
  artifactIds: ["project:123"],
  selection,
});
```

## Plugin

```ts
import type {
  InteractionPlugin,
} from "@axrail/interaction-sdk";

export const engineeringContextPlugin: InteractionPlugin = {
  id: "vendor.engineering-context",
  version: "1.0.0",

  setup(api) {
    const disposeContext = api.registerContextContributor({
      id: "vendor.current-work-area",

      async contribute(turn) {
        return {
          kind: "vendor.work-area.context",
          content: await readNormalizedWorkArea(turn),
          metadata: {
            purpose: turn.purpose,
          },
        };
      },
    });

    const disposeBefore = api.registerBeforeTurn((turn) => {
      if (!turn.providerId) {
        throw new Error("Provider is required");
      }
    });

    const disposeEvents = api.onEvent((event) => {
      // Observational UI/telemetry extension.
      console.debug(event.type);
    });

    return () => {
      disposeEvents();
      disposeBefore();
      disposeContext();
    };
  },
};

await interaction.mount(engineeringContextPlugin);
```

Plugin setup is locally transactional: if setup throws after making registrations, the host removes those registrations and the plugin is not considered mounted.

## HMI scoped editing

Combine with `@axrail/hmi-adapter-kit`:

```ts
import {
  hmiRegionSelection,
} from "@axrail/hmi-adapter-kit";

const selection = hmiRegionSelection({
  selectionId: "sel:456",
  providerId: "vendor-hmi",
  projectId: "project:123",
  screenId: "screen:overview",
  componentIds: ["pump-101", "valve-102"],
  bounds: {
    x: 100,
    y: 60,
    width: 600,
    height: 300,
    coordinateSpace: "screen:overview",
  },
});

await interaction.send({
  message: "Move the pump left and valve right",
  providerId: "vendor-hmi",
  artifactIds: ["project:123"],
  selection,
});
```

The HMI/editor still owns hit testing and mutable UI selection. The Interaction Runtime receives a frozen Selection snapshot for the current turn.

## Context rules

Interaction context is assembled from:

```text
SelectionContext
+
explicit Adapter Context
+
InteractionPlugin Context
```

The SDK:

- validates Selection provider scope;
- validates Adapter Context provider scope;
- excludes sensitive context unless explicitly enabled;
- wraps context as untrusted engineering data;
- enforces a context character budget;
- fails rather than silently truncating an over-budget context.

## Plugin extension points

First version:

- `registerModel()`
- `registerContextContributor()`
- `registerBeforeTurn()`
- `registerAfterTurn()`
- `onEvent()`

Failure semantics:

- Context contributor failure: fail the turn before Agent execution.
- Before-turn failure: fail closed before Agent execution.
- After-turn failure: observational; does not rewrite completed Agent truth.
- Event observer failure: observational; isolated.

## First-version limitations

The first implementation is deliberately **turn-oriented**.

It does not yet freeze:

- persisted multi-turn conversation continuation;
- streaming token/delta UI contracts;
- plugin package discovery;
- plugin marketplace conventions;
- untrusted plugin sandboxing;
- React/Vue chat components.

Future conversation continuation should converge on authoritative Harness Session/Event semantics instead of creating another transcript store.

## Architecture

See:

- `docs/architecture/interaction-sdk-plugin-architecture.md`
- RFC-0011
- RFC-0010 for Selection Context
- AI-native HMI integration guide


## Model registry and switching

For multiple selectable models, use `ModelRegistry`:

```ts
import {
  InteractionRuntime,
  ModelRegistry,
} from "@axrail/interaction-sdk";

const models = new ModelRegistry();

models.register({
  descriptor: {
    id: "fast",
    providerId: "vendor-a",
    displayName: "Fast model",
    capabilities: {
      toolCalling: true,
      reasoning: false,
    },
  },
  provider: fastProvider,
});

models.register({
  descriptor: {
    id: "reasoning",
    providerId: "vendor-b",
    displayName: "Reasoning model",
    capabilities: {
      toolCalling: true,
      reasoning: true,
    },
  },
  provider: reasoningProvider,
});

const interaction = new InteractionRuntime({
  harness,
  models,
  defaultModelId: "fast",
});

const available = interaction.models.list();

await interaction.send({
  message: "Modify the selected engineering objects",
  providerId: "vendor-hmi",
  modelId: "reasoning",
  requiredModelCapabilities: ["toolCalling", "reasoning"],
  selection,
});
```

Resolution order:

```text
send.modelId
  ↓
defaultModelId
  ↓
single registered model
  ↓
otherwise fail closed
```

No automatic routing or silent fallback is performed in the first version.

### Model plugin

Interaction plugins may register model providers:

```ts
const modelPlugin: InteractionPlugin = {
  id: "vendor.private-model",

  setup(api) {
    return api.registerModel({
      descriptor: {
        id: "factory-model",
        providerId: "vendor-private",
        capabilities: {
          toolCalling: true,
        },
      },
      provider: privateProvider,
    });
  },
};
```

Model registration follows plugin rollback/unmount semantics.

### Credential boundary

`InteractionModelDescriptor` contains no credential field.

Keep credentials inside the concrete model provider:

```ts
new OpenAICompatibleResponsesProvider({
  model: "your-model",
  apiKey: async () => secretStore.get("MODEL_API_KEY"),
});
```

Do not copy model credentials into Selection, Context, interaction events, model descriptors or audit metadata.

### Provenance

Each Interaction result/event identifies:

```text
modelId
modelProviderId
runtimeProviderId
```

This is provenance, not Approval/Policy authority.

See `docs/architecture/model-registry-runtime-selection.md` and RFC-0012.

## Preferred multi-provider model bridge

For v0.2, use `@axrail/model-ai-sdk` with the Vercel AI SDK provider ecosystem instead of adding a hand-written Axrail HTTP client for every model vendor.

```ts
import { AiSdkModelProvider } from "@axrail/model-ai-sdk";
// import the Vercel AI SDK provider package your product actually uses.

const provider = new AiSdkModelProvider({
  id: "engineering-model-runtime",
  model: vendorLanguageModel,
});

interaction.models.register({
  descriptor: {
    id: "engineering-model",
    providerId: "vendor",
    capabilities: {
      toolCalling: true,
    },
  },
  provider,
});
```

The embedding product owns provider-package installation and credentials. Axrail does not require Vercel AI Gateway. The bridge performs one model step and does not execute engineering Tools itself.
