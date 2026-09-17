# AI-native HMI / 组态产品接入指南

[English](README.md) | [简体中文](README.zh-CN.md)

状态：**用于 post-RC Axrail `main` 的接入准备交付版**

本指南面向需要把 AI-native HMI、SCADA、组态、可视化或工程软件接入 Axrail 的产品/研发团队。

第一阶段目标不是把所有部署与运行时能力一次性接完，而是先跑通一条安全、真实、provider-bound 的最小纵向链路：

```text
读取工程
  ↓
读取画面 / 工程上下文
  ↓
构造一个真实工程 ChangeSet
  ↓
Preview，或者明确报告 degraded / unsupported
  ↓
Policy + Validation + Approval
  ↓
provider-bound apply
  ↓
verify
  ↓
commit
  ↓
至少验证一条真实失败 / 恢复路径
```

## 1. 版本基线

当前 npm 已发布版本为：

```text
0.1.0-rc.1
```

对应源码 commit：

```text
e4758656c20f6cb90b05eb3429c79010667a2f7d
```

这个 npm RC1 **不包含**本指南使用的 post-RC 高层 `HarnessRuntime.executeChangeSet()` API。

当前接入应使用包含 provider-bound Transactional Mutation API 的 Axrail `main`，最低建议基线：

```text
05d73d4ff336ea7375388fdbd719d21f246e658f
```

或使用未来明确包含该 API 的 npm 版本。

不要把 npm RC1 的 API 和当前 `main` 的 post-RC API 当成完全相同。

## 2. 对接边界

Axrail 保持 vendor-neutral。产品专属 Adapter 负责连接真实产品，Axrail 负责受治理的执行语义。

```text
你们的 AI 对话框 / Agent UI
          ↓
       Axrail Agent
          ↓
      HarnessRuntime
          ↓
   Tool / Change Proposal
          ↓
        ChangeSet
          ↓
       Transaction
    ├─ Policy
    ├─ Validation
    ├─ Approval
    └─ Audit
          ↓
ProviderBoundTransactionExecutor
          │ providerId
          ↓
      HMI Adapter
          ↓
   产品内部 SDK / API
```

通用 Harness 不应 import 私有 HMI schema 或厂商 SDK。

### 可以进入公开 Axrail 的内容

- 通用 HMI capability 名称；
- 通用 Artifact / ChangeSet / Tool / Context 合同；
- vendor-neutral 示例；
- 通用 Policy / Validation / Approval / Transaction / Audit / Recovery 语义；
- 经过抽象、脱敏和评审后的接入反馈。

### 必须保留在产品私有仓库中的内容

- 私有 project/screen/component schema；
- 内部 SDK/API client；
- 认证实现与凭据；
- 客户工程数据；
- 私有 renderer/runtime；
- 产品专属部署、存储和迁移实现。

## 3. 典型依赖

真实 HMI 接入通常会使用：

```text
@axrail/harness
@axrail/adapter-sdk
@axrail/hmi-adapter-kit
@axrail/artifacts
@axrail/changesets
@axrail/transactions
@axrail/policy
@axrail/validation
@axrail/approval
```

`@axrail/hmi-adapter-kit` 是构建在通用 Adapter SDK 之上的 HMI domain SDK，不是 Harness/kernel 依赖。

## 4. 最小 Adapter

首先实现一个有稳定 provider identity 的 `AxrailAdapter`：

```ts
import type { AxrailAdapter } from "@axrail/adapter-sdk";
import {
  HMI_CAPABILITIES,
  createHmiCapabilityManifest,
  exactHmiCapabilities,
} from "@axrail/hmi-adapter-kit";

export const adapter: AxrailAdapter = {
  id: "your-hmi",
  version: "0.1.0",

  async capabilities() {
    return createHmiCapabilityManifest({
      adapterId: "your-hmi",
      adapterVersion: "0.1.0",
      protocolVersion: "0.1",
      target: {
        vendor: "Your Company",
        product: "Your HMI",
        version: "product-version",
      },
      support: exactHmiCapabilities(
        HMI_CAPABILITIES.PROJECT_ARTIFACT,
        HMI_CAPABILITIES.PROJECT_INSPECT,
      ),
    });
  },

  tools() {
    return [];
  },
};
```

Adapter 生命周期：

```text
registered
  ↓
initializing
  ↓
ready
  ↓
active
  ↓
stopping
  ↓
stopped
```

mount 失败时，Axrail 会清理已经注册的本地 provider surface；unmount 时先移除本地路由，再执行外部 stop。

## 5. CapabilityManifest：只报告真实能力

HMI kit 当前标准 capability：

```text
hmi.project.artifact
hmi.project.inspect
hmi.screen.create
hmi.screen.update
hmi.component.add
hmi.component.update
hmi.binding.create
hmi.project.validate
hmi.preview
hmi.deploy
```

每一个 capability 必须明确报告：

```text
exact
compatible
degraded
unsupported
```

含义：

- `exact`：产品能力与合同直接一致；
- `compatible`：语义一致，但需要 Adapter 转换；
- `degraded`：可用，但有明确限制；
- `unsupported`：当前确实不支持。

不要因为“以后准备做”就声明 `exact`。

例如：

```ts
support: {
  [HMI_CAPABILITIES.PROJECT_INSPECT]: { level: "exact" },
  [HMI_CAPABILITIES.PREVIEW]: {
    level: "degraded",
    notes: "只能预览单画面，暂不执行运行时脚本",
  },
  [HMI_CAPABILITIES.DEPLOY]: {
    level: "unsupported",
    reason: "第一阶段暂不接部署",
  },
}
```

## 6. Artifact 与并发版本

可持久化的工程目标需要表示为 Axrail Artifact。

当前 HMI kit 已提供工程引用：

```ts
import { hmiProjectRef } from "@axrail/hmi-adapter-kit";

const projectRef = hmiProjectRef("project:123", {
  provider: "your-hmi",
  version: "42",
});
```

真实 Adapter 的 `ArtifactProvider` 至少应提供：

- 稳定 Artifact ID；
- 当前 version / revision / ETag 或等价并发 token；
- exists；
- 足够用于治理和验证的 normalized metadata。

重要约束：

```text
Artifact.provider
        =
TransactionExecutor.providerId
```

如果产品本身存在 revision / revisionId / ETag / project version，请直接使用真实版本语义，不要为了接 Axrail 另造一个弱版本计数器。

发生版本冲突时必须阻止提交，不能静默覆盖其他工程师刚刚完成的修改。

## 7. 工程 Context

Adapter Context 必须显式获取，并且 provider-scoped。Axrail 不会自动把 Adapter Context 塞进模型 prompt。

建议第一阶段提供这些 Context：

```text
工程摘要
工程树
当前/选中画面
画面组件摘要
可用控件/组件类型
Tag / Binding 摘要
运行/部署目标元数据
```

示例：

```ts
context() {
  return [{
    id: "project-context",
    async build(request) {
      return {
        providerId: "your-hmi",
        kind: "hmi.project.context",
        content: await buildNormalizedProjectContext(request),
        sensitive: false,
      };
    },
  }];
}
```

显式获取：

```ts
const fragments = await harness.adapters.buildContext(
  {
    purpose: "design-screen",
    artifactIds: ["project:123"],
  },
  {
    adapterIds: ["your-hmi"],
    includeSensitive: false,
  },
);
```

规则：

1. Sensitive Context 默认排除。
2. 不要把 token、账号凭据、客户 secret 放入模型 Context。
3. 优先给模型 normalized engineering context，不要直接 dump 完整私有工程 schema。
4. 保留稳定真实 ID，让后续 ChangeSet 可以引用实际工程对象。

## 8. Read Tool 与工程写操作分离

HMI kit 当前定义的典型 Tool：

```text
project inspect      L0 read
screen create        L2 engineering write
screen update        L2 engineering write
component add        L2 engineering write
component update     L2 engineering write
binding create       L2 engineering write
project validate     L0 read
preview              L1 local write
deploy               L3 deploy
```

第一阶段原则：

- inspect/read Tool 可以直接调用产品只读 API；
- 持久化 L2/L3 工程修改应走 `ChangeSet + Transaction`；
- 不允许用 Tool handler 偷偷绕过 Transaction，直接完成不可审计写入。

## 9. ChangeSet

ChangeSet 是 Agent/用户准备执行的“工程修改提案”，必须可以被审查、验证、审批和绑定 evidence。

示例：

```ts
import type { ChangeSet } from "@axrail/changesets";
import { hmiProjectRef } from "@axrail/hmi-adapter-kit";

const changeSet: ChangeSet = {
  id: "cs:add-temperature-card",
  protocolVersion: "0.1",
  artifacts: [
    hmiProjectRef("project:123", {
      provider: "your-hmi",
      version: currentProjectVersion,
    }),
  ],
  reason: "在 Overview 中增加温度显示",
  actor: {
    id: currentUserId,
    type: "human",
  },
  operations: [
    {
      id: "add-component",
      op: "create",
      target: "screen:overview/component",
      value: {
        semanticType: "temperature-display",
        binding: { source: "tag:temperature" },
      },
      risk: {
        level: "L2",
        reasons: ["修改工程组态"],
      },
    },
  ],
};
```

推荐让 ChangeSet 表达**工程语义**，由私有 Adapter / executor 转换为产品内部 schema 和 API 调用。

不要把内部整棵 object tree 当成 Axrail 通用协议。

## 10. ProviderBoundTransactionExecutor

post-RC 高层执行路径里，`executor.providerId` 是唯一权威 provider identity。

```ts
import type {
  ProviderBoundTransactionExecutor,
} from "@axrail/harness";

const executor: ProviderBoundTransactionExecutor = {
  id: "your-hmi.project-executor",
  providerId: "your-hmi",
  mode: "atomic",

  async prepare(transaction) {
    // 可选：建立产品自己的 edit session / staged transaction。
  },

  async apply(transaction) {
    // 把 immutable ChangeSet 转成产品 API 操作。
    // 如果产品支持 staging，这里不要提前做最终 durable commit。
    return { externalRef: "native-change-id" };
  },

  async verify(transaction, result) {
    // 校验真实工程后置条件，而不只是 API 返回 success。
    return true;
  },

  async commit(transaction, result) {
    // 产品支持 staged commit 时在这里形成最终持久工程状态。
  },

  async rollback(transaction, result) {
    // 必须返回真实 rollback / compensation 结果。
    return { complete: true };
  },
};
```

执行：

```ts
const result = await harness.executeChangeSet(changeSet, {
  executor,
  environment: "design",
  actor: changeSet.actor,
  sessionId,
  correlationId,
  requiredApprovers: [{ role: "controls-engineer", count: 1 }],
});
```

Harness 会从：

```text
executor.providerId
```

自动推导 Policy / Validation 的 Adapter scope。

执行前会 fail closed：

- `providerId` 为空；
- 对应 Adapter 未 mounted；
- ChangeSet Artifact 声明了不同 provider。

高层 mutation 不要再另外维护一个可独立变化的 `adapterId`。

## 11. Transaction mode 不能写错

### `atomic`

只有产品真正支持 staging + 原子 commit，或者能保证外部可见工程状态原子变化时才使用。

### `compensating`

apply 期间可能已经产生效果，但产品有真实 compensation/undo 能力。

### `best_effort`

无法承诺完整 rollback。

“只有一个 API 请求”不等于 atomic。

## 12. Policy

Policy 回答：**这个操作允许执行吗？**

典型输入包括：

- environment；
- actor；
- risk level；
- Adapter/provider；
- target resource；
- transaction mode；
- project/runtime target classification。

第一阶段可以只实现少量 policy，但至少验证：

```text
一个允许路径
+
一个 deny 或 require-approval 路径
```

Privileged mutation 缺少治理信息时应 fail closed。

## 13. Validation

Validation 回答：**这个工程修改在技术上是否合法？**

建议阶段：

```text
schema
semantic
domain
adapter
safety
post_execution
```

HMI 常见验证：

- screen/component ID 是否存在；
- component type 是否支持；
- layout/property 是否有效；
- tag/binding 是否存在且类型兼容；
- 是否存在重复 ID；
- 是否满足产品内部约束；
- 目标版本/运行目标是否支持所需能力。

Policy allow 不等于 Validation valid。

## 14. Approval

Approval 必须绑定同一个 immutable ChangeSet evidence。

当 Policy 要求审批时，Axrail 会把审批绑定到 ChangeSet canonical digest。

ChangeSet 内容变化后，旧审批不能继续授权新内容。

第一阶段建议至少验证一次需要审批的 L2 工程修改。

产品 UI 可以承载审批体验，但审批必须绑定 Axrail 最终执行的同一 evidence。

## 15. Preview

Preview 可以不支持，但不能“假支持”。

有效 Preview 可以是：

- normalized diff；
- 画面截图/引用；
- 受影响 screen/component/binding 列表；
- 产品原生 change preview；
- unsupported/degraded 警告。

如果能力不完整，声明 `compatible` / `degraded`；完全无法可靠预览时声明 `unsupported`。

不要把“当前画面渲染结果”冒充“包含 ChangeSet 后的预览”。

## 16. verify 与 commit

`apply` 后的 `verify` 应验证真正后置条件，不应只检查 HTTP 200 或 API success。

例如：

- 新 screen 确实存在；
- component 的稳定 ID、类型和属性正确；
- binding 真实指向目标 tag；
- staged state 与 ChangeSet 一致；
- version 变化符合预期。

commit 应表示产品语义中的“该修改已经成为 durable / authoritative 工程状态”。

## 17. 失败、回滚与不确定性

第一轮必须至少主动测试一个失败路径：

```text
validation failure
version conflict
approval denial
apply failure
verify failure
commit failure
rollback / compensation failure
```

规则：

1. 没有产品确认，就不要宣称 rollback 成功。
2. 外部 effect 状态不确定时，不要自动重试，除非已经证明 idempotence 与目标状态。
3. 如果 timeout 后产品可能已经写入，必须保留 uncertainty，而不是当成普通安全失败。
4. 设备安全、联锁、安全 PLC 等 deterministic safety control 仍然在模型之外。

## 18. 推荐接入顺序

### A — 先登记接入事实

反馈给 Axrail：

- 目标仓库/模块标识；
- Adapter 集成目录；
- 产品版本；
- SDK/API/extension 机制；
- 认证方式说明（不要提交 secret）；
- 原生工程 version/revision 机制。

### B — Adapter + CapabilityManifest

实现 Adapter 生命周期和真实 capability manifest，确保可以 mount。

### C — 只读链路

先实现：

```text
Project Artifact
Project Inspect
Project / Screen Context
```

暂时不写工程。

### D — 一个 ChangeSet 修改

优先选择简单 L2 工程修改：

```text
screen create
或
component add/update
```

第一轮不要从 deploy 或物理动作开始。

### E — Preview + Validation

有真实 preview 就接；没有就明确 unsupported/degraded。至少实现一个产品级 validator。

### F — Governed Execution

通过 provider-bound `executeChangeSet()` 执行：

```text
Policy
→ Validation
→ Approval（需要时）
→ Apply
→ Verify
→ Commit
```

### G — Failure / Recovery

主动验证至少一条失败或恢复路径。

### H — 反馈

填写 `feedback-template.md`，返回给 Axrail 侧。

## 19. 第一轮验收 Checklist

- [ ] Adapter 有唯一稳定 provider ID。
- [ ] mount / unmount 正常。
- [ ] CapabilityManifest 如实报告 exact/compatible/degraded/unsupported。
- [ ] Project Artifact.provider 与 executor.providerId 一致。
- [ ] ArtifactProvider 使用真实工程 version/revision token。
- [ ] Project inspect 已接通。
- [ ] Context 获取显式且 provider-scoped。
- [ ] Sensitive Context 默认排除。
- [ ] 至少一个 L2 修改转换成 ChangeSet。
- [ ] Mutation 使用 `ProviderBoundTransactionExecutor`。
- [ ] Policy/Validation scope 来自 executor provider。
- [ ] Artifact provider mismatch 在 effect 前失败。
- [ ] 至少执行一个产品专属 validator。
- [ ] Policy 要求时能完成 Approval。
- [ ] Preview 真实，或明确 degraded/unsupported。
- [ ] 并发/version conflict 行为已定义。
- [ ] Transaction mode 与产品真实能力一致。
- [ ] verify 检查真实后置条件。
- [ ] 至少验证一条 failure/recovery 路径。
- [ ] 没有把私有 schema、凭据或客户数据提交到公开 Axrail。
- [ ] 已填写反馈模板。

## 20. 第一轮结束后需要返回什么

使用 [feedback-template.md](feedback-template.md)。

请重点反馈：

- 哪些 Axrail 抽象和产品天然匹配；
- 哪些地方需要大量 translation；
- 哪些 contract 表述不清楚；
- Axrail 是否迫使产品泄露不必要的私有 schema；
- 真实工程流程缺少哪些能力；
- providerId / Artifact / version / Context / ChangeSet / transaction mode 是否好建模；
- Preview / Validation / Approval 顺序是否符合真实产品生命周期；
- 是否遇到 Axrail 无法如实表达的 failure / uncertainty；
- 建议修改的 API，私有细节可以脱敏后说明。

第一轮反馈的目的不是证明 Axrail “已经设计正确”，而是用真实产品反向修正 Axrail 协议。

## 21. 安全与数据处理

不要提交到公开 Axrail：

```text
账号凭据 / token
客户工程文件
客户名称
私有 endpoint
内部 SDK 源码
完整私有 schema
生产部署细节
安全 PLC / 联锁逻辑
工程文件中包含的 secret
```

如果需要反馈协议问题，请使用能够复现问题的最小脱敏样例。

## 22. 参考代码

接入时优先看：

- `examples/hmi-agent` — vendor-neutral HMI Transaction 示例；
- `packages/hmi-adapter-kit` — HMI capability、Tool、Artifact 与 manifest helper；
- `packages/adapter-sdk` — Adapter 生命周期、Context、provider 注册；
- `packages/harness` — 高层 Harness 与 provider-bound ChangeSet 执行；
- RFC-0006 — Adapter Protocol；
- RFC-0009 — Transactional Mutation Pipeline。

真实 HMI 的第一次接入就是用来挑战这些协议的。当前 post-RC 高层 API 仍然是 pre-stable；接入方发现问题后，应优先把问题和建议返回，而不是为了适配当前 API 在私有产品里堆大量不可维护的 workaround。