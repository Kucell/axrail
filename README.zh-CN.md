# Axrail

[English](README.md) | **简体中文**

**面向工业与工程软件的事务型 AI 执行基础设施。**

Axrail 是一套开源 Harness 基础设施，用于让 AI Agent 以受治理的方式理解、修改、验证并执行工程工作流。它刻意保持厂商中立，也不依赖任何私有 HMI 实现。

> Axrail 在模型意图与工程系统实际副作用之间建立一条受治理的执行边界。

## 运行环境支持

Axrail v0.1 面向 **Node.js 20 或更高版本**，并且是 **纯 ESM（ESM-only）**。公共包提供 ESM `import` 入口；CommonJS `require()` 不属于 v0.1 的支持范围。

## 执行模型

```text
Intent
  ↓
Artifact
  ↓
ChangeSet
  ↓
Transaction
  ├─ Policy
  ├─ Validation
  └─ Approval
  ↓
Tool / Adapter / MCP
  ↓
Commit or Rollback
```

Axrail 的目标不是简单的 `model → tool → execute`。重要工程变更会先被表达成显式、可审查的数据，再提交到目标系统。

## Runtime 基础

已实现的 v0.1 基础能力包括：

- **`@axrail/harness`** — 主要高层组合入口，把 Adapter、Tool、Policy、Approval、Event、Session、Agent、Transaction、按 Provider 路由的 Tool，以及显式 Audit Profile 组合成可嵌入的 Harness Runtime。
- **`@axrail/tools`** — 受治理的 Tool 注册与执行、不可变 Tool 调用证据、按 Provider 进行语义 Tool 解析、L0-L5 风险元数据、Policy/Approval Hook、超时与副作用不确定性语义、后置条件不确定性处理，以及特权执行 fail-closed 机制。
- **`@axrail/artifacts`** — 可移植的工程 Artifact 标识、版本、快照与 Provider 抽象。
- **`@axrail/changesets`** — 结构化工程变更、操作、前置条件、风险元数据、不可变快照，以及规范化 SHA-256 摘要。
- **`@axrail/validation`** — 可组合的 Schema、Semantic、Domain、Adapter、Safety 与执行后 Validation 阶段，并支持按 Provider 限定 Adapter 范围。
- **`@axrail/policy`** — deny-overrides 的 Policy 组合，默认拒绝，并提供确定性的 obligations。
- **`@axrail/approval`** — Approval Request、quorum/角色要求、过期控制、证据绑定，以及 Provider 不可用时的 fail-closed 行为。
- **`@axrail/transactions`** — Transaction 状态机、不可变 ChangeSet 证据、乐观并发控制、atomic/compensating/best-effort Executor、Validation/Policy/Approval Bridge、审计检查点与显式 Rollback。
- **`@axrail/events`** — 可观测 Runtime Event Envelope、EventStore 合约、Session 生命周期、Correlation、Replay、内存存储，以及可持久化 append-only JSONL 参考实现。
- **`@axrail/adapter-sdk`** — 厂商中立的 Adapter 生命周期、原子挂载、Provider 绑定、显式 Context 获取、Capability Manifest，以及已文档化的实验性高级组合子路径。
- **`@axrail/mcp`** — 受治理的 MCP Tool Bridge，以及基于官方 MCP TypeScript SDK v2 的 HTTP/stdio Client 集成，并支持 Descriptor 刷新与重新风险分类。
- **`@axrail/agent`** — 与模型无关的进程内 Agent Loop，包含 append-only 内存对话历史、顺序受治理 Tool 执行、失败批次控制、Provider Scope Tool Discovery，以及默认隔离的观测事件机制。
- **`@axrail/model-openai-compatible`** — 面向 OpenAI-compatible Responses API 的 Provider Adapter，也兼容 DeepSeek 风格端点。
- **`@axrail/hmi-adapter-kit`** — 构建在 `@axrail/adapter-sdk` 之上的可选厂商中立 HMI Domain SDK；它不是 Harness/Kernel 的依赖。
- **`@axrail/cli`** — 只读诊断 CLI，用于 EventStore 检查与 ChangeSet 证据摘要计算。

`@axrail/core` 仍保留在 monorepo 中，用于**实验性的 capability/plugin kernel 研究**。它保持 private，不属于 v0.1 支持的公共包集合；当前支持的组合模型是 `@axrail/harness` + `AdapterHost`，RFC-0004 属于探索性研究，而不是必须再引入第二套 Runtime Kernel 的要求。

## Release Candidate 状态

v0.1 支持的 package/API surface、TypeScript project-reference 构建策略、lockstep version policy、最终 Architecture Gate，以及 RC 后 hardening 均已完成。

全部 15 个受支持公共包已经发布到 npm：

```text
0.1.0-rc.1
```

使用 `rc` dist-tag，并带有 GitHub Actions provenance。已发布工件对应的精确源码 commit 为：

```text
e4758656c20f6cb90b05eb3429c79010667a2f7d
```

CI 在 Node 20、22、24 上验证：

```text
frozen install
  ↓
source type-check
  ↓
tsc -b ESM + declarations
  ↓
73 behavioral tests
  ↓
package dependency-closure audit
  ↓
pack 15 package tarballs
  ↓
clean npm consumer install
  ↓
runtime import every public package
  ↓
runtime import documented Adapter SDK advanced subpaths
  ↓
strict NodeNext TypeScript consumer compile
  ↓
packaged axrail --version
```

npm RC 包已经公开。Annotated `v0.1.0-rc.1` Git tag 与 GitHub prerelease 会在 registry verification 后单独完成 finalize。

参见 [v0.1 Release Readiness](docs/release/v0.1-readiness.md)、[v0.1 Public API Surface](docs/release/v0.1-public-api.md)、[Execution Boundary Semantics](docs/execution-semantics.md) 与 [Release Hardening](docs/release/README.md)。



## post-RC main 新增能力

当前 `main` 已包含一些**晚于 npm 已发布 15 个 `0.1.0-rc.1` 包**的 pre-stable 能力：

- **Provider-bound Transactional Mutation** — 高层 `HarnessRuntime.executeChangeSet()`。
- **Selection Context** — 面向工程编辑器点击/多选/框选的显式 provider-scoped Selection 协议。
- **`@axrail/interaction-sdk`** — 可选 headless AI 交互核心，提供受限 Context 组合、统一事件、typed/reversible Interaction Plugin，以及 Model Registry / runtime model selection。

Interaction SDK 采用“核心 + 插件”的局部扩展模型，但不会恢复 Axrail-wide generic plugin kernel。Interaction Plugin 通过 SDK 合同不能替换或绕过 ToolRuntime、Policy、Validation、Approval、TransactionRuntime 或 provider-bound execution。

参见 [Interaction SDK Core + Plugin Architecture](docs/architecture/interaction-sdk-plugin-architecture.md)、[RFC-0010](rfcs/0010-interactive-selection-context/README.md) 与 [RFC-0011](rfcs/0011-interaction-sdk-plugin-model/README.md)。

## 厂商中立示例

### Hello Agent

[`examples/hello-agent`](examples/hello-agent/) 是最小可运行示例。它使用 `HarnessRuntime`、确定性模型、一个 L0 read Tool，以及一个需要 Approval 的 L2 engineering-write Tool。

```bash
pnpm --filter @axrail/example-hello-agent start
```

不需要 API Key，也不需要工业硬件。

### HMI 参考流程

HMI/SCADA 是第一个参考领域，而不是通用 Harness Runtime 的依赖。

[`examples/hmi-agent`](examples/hmi-agent/) 展示了一条不依赖模型 API Key、也不包含私有 HMI 代码的厂商中立路径。它通过 `@axrail/hmi-adapter-kit` 使用 HMI Capability Name、Artifact Reference、Tool Contract 与 Capability Manifest。

```text
Deterministic model
      ↓
AgentLoop
      ↓
ToolRuntime
      ↓
hmi.screen.create (L2)
      ↓
ChangeSet
      ↓
TransactionRuntime
   ├─ PolicyEngine
   ├─ ValidationPipeline
   └─ ApprovalService
      ↓
Mock HMI Adapter
      ↓
Commit
```

多个 HMI/工程 Adapter 可以暴露相同的语义 Tool 名称。Axrail 将语义 Tool Identity 与 Provider Identity 分离；当 Provider 解析存在歧义时会 fail closed。

商业 HMI、PLC IDE、Robot Platform、MES、CAD/CAE Tool 或 Digital Twin 环境，都可以通过 Axrail Adapter 替换 Mock Boundary。

真实 AI-native HMI / 组态产品接入请直接使用 [AI-native HMI / 组态产品接入指南](docs/integrations/ai-native-hmi/README.zh-CN.md) 与 [接入反馈模板](docs/integrations/ai-native-hmi/feedback-template.md)。该指南面向 post-RC `main`，并明确区分当前 provider-bound 高层 mutation API 与已经发布的 npm `0.1.0-rc.1`。

## MCP 边界

MCP 被视为互操作层，而不是 Axrail 的内部对象模型。

```text
LLM / Agent
    ↓
Axrail Tool Runtime
    ↓
Risk / Policy / Approval / Transaction
    ↓
MCP Bridge
    ↓
External MCP Server
```

MCP Tool Annotation 只被视为提示。非可信 Server 不能仅通过声明 Tool 为 read-only 来降低 Axrail 的风险等级。同名 MCP Tool 的 Descriptor 一旦变化，会触发重新注册与重新风险分类，避免过期的可信元数据被静默保留。

## Audit Profiles

Harness 部署可选择：

```text
best_effort
required_before_effect
required_before_commit
```

严格 Profile 会在受保护执行边界之前持久化权威 `audit.effect.checkpoint` / `audit.commit.checkpoint` 记录。普通的副作用后生命周期事件仍然是 observational，这样 EventStore 的 telemetry 故障不会错误声称一个已经发生的副作用并未发生。

`best_effort` 是默认的开发/嵌入式 Profile，而不是生产安全建议。对于部署、物理动作、安全敏感、受监管，或其他依赖审计的环境，应显式选择严格 Profile，并提供具备相应持久性保证的 EventStore。

参见 [Audit Model](docs/audit-model.md)。

## 安全边界

Axrail 的软件 Policy 与 Approval **不能替代** Safety PLC、Interlock、Emergency Stop、SIL/PL 等级安全功能、机器控制器安全逻辑，或受监管的操作规程。

物理动作与安全关键动作必须继续由模型之外的确定性控制机制约束。

## Architecture、Release 与 RFC

- [Architecture overview](docs/architecture/README.md)
- [Architecture and design](docs/architecture/design.md)
- [AI-native HMI / 组态产品接入指南](docs/integrations/ai-native-hmi/README.zh-CN.md)
- [HMI Integration Feedback Template](docs/integrations/ai-native-hmi/feedback-template.md)
- [Execution boundary semantics](docs/execution-semantics.md)
- [Audit model](docs/audit-model.md)
- [Release hardening](docs/release/README.md)
- [v0.1 Release Readiness](docs/release/v0.1-readiness.md)
- [v0.1 Public API Surface](docs/release/v0.1-public-api.md)
- [RFC-0001: Artifact Model](rfcs/0001-artifact-model/README.md)
- [RFC-0002: ChangeSet Protocol](rfcs/0002-changeset-protocol/README.md)
- [RFC-0003: Transaction Runtime](rfcs/0003-transaction-runtime/README.md)
- [RFC-0004: Capability & Plugin Model](rfcs/0004-capability-plugin-model/README.md)
- [RFC-0005: Tool Runtime & Risk Model](rfcs/0005-tool-runtime-risk-model/README.md)
- [RFC-0006: Adapter Protocol](rfcs/0006-adapter-protocol/README.md)
- [RFC-0007: Policy & Approval Model](rfcs/0007-policy-approval-model/README.md)
- [RFC-0008: Event & Session Model](rfcs/0008-event-session-model/README.md)
- [RFC-0009: Transactional Mutation Pipeline](rfcs/0009-transactional-mutation/README.md)
- [RFC-0010: Interactive Selection Context](rfcs/0010-interactive-selection-context/README.md)
- [RFC-0011: Headless Interaction SDK and Plugin Model](rfcs/0011-interaction-sdk-plugin-model/README.md)
- [RFC-0012: Model Registry and Runtime Model Selection](rfcs/0012-model-registry-runtime-selection/README.md)

## Workspace

```text
packages/       Runtime packages and SDKs
examples/       厂商中立参考集成
tests/          跨 package behavioral tests
docs/           Architecture 与开发者文档
rfcs/           Protocol 与 Architecture proposals
.github/        CI 与仓库自动化
```

## 快速开始

```bash
corepack enable
pnpm install
pnpm check
pnpm test
pnpm pack:smoke
pnpm axrail --help
```

常用诊断命令：

```bash
pnpm axrail events inspect ./events.jsonl --correlation work-order-42
pnpm axrail changeset digest ./changeset.json
```

v0.1 CLI 刻意保持只读/诊断用途；它不提供绕过受治理工业副作用边界的特权通道。

## 当前优先事项

v0.1 Runtime/Release 基础以及首次 npm bootstrap publication 已完成。当前工程主线为：

```text
Architecture Convergence
  ↓
Transactional Mutation
  ↓
Real HMI Adapter validation
  ↓
Engineering Runtime
  ↓
Second Adapter validation
  ↓
v0.2 stabilization
```

RC1 运维收口并行进行：为后续发布配置 stage-only Trusted Publisher，并从精确 provenance commit `e4758656c20f6cb90b05eb3429c79010667a2f7d` finalize `v0.1.0-rc.1` GitHub tag/prerelease。一次性 bootstrap npm credential 按维护者当前决定暂时保留，但不作为后续常规发布机制。

## License

Apache-2.0。参见 [LICENSE](LICENSE)。

## v0.2 运行时与模型 Provider 方向

post-RC/v0.2 开发基线提升为 **Node.js 22.13+**，CI 兼容矩阵调整为 Node 22 / 24 / 26。

后续模型供应商推荐统一走：

```text
@axrail/interaction-sdk ModelRegistry
        ↓
AgentModelProvider
        ▲
@axrail/model-ai-sdk
        ↓
Vercel AI SDK
        ↓
供应商 Provider / 私有 LanguageModel
```

这样 Axrail 不再为 OpenAI、Anthropic、Google 等模型分别维护 HTTP 请求协议，而专注于工程 Tool 治理、ChangeSet、Transaction、Policy、Approval 与 Adapter。

Vercel AI SDK 只负责模型 Provider 基础设施，不替代 Axrail AgentLoop/ToolRuntime；桥接层不会给 AI SDK Tool 定义 execute handler。

`@axrail/model-openai-compatible` 暂时保留为轻量/reference compatibility 路径。

参见 [Model Provider Convergence on Vercel AI SDK](docs/architecture/model-provider-ai-sdk-convergence.md) 和 [RFC-0013](rfcs/0013-ai-sdk-provider-convergence/README.md)。

已经发布的 npm `0.1.0-rc.1` 仍然是 Node >=20、15 package 的历史版本，不被 v0.2 这次调整追溯修改。
