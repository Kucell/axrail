# 组态软件 Selection / AI Scoped Editing 接入设计说明模板

> 由真实 AI-native HMI / 组态软件接入团队填写。  
> 不要在此文档提交 token、密码、客户工程文件、私有 endpoint 或完整私有 schema。

## 1. 产品与集成模块

- 产品名称/版本：
- 接入仓库或 workspace：
- Axrail Adapter 所在模块/目录：
- AI 对话框所在模块：
- 主要技术栈：
- Browser / Electron / WebView / Native / 其他：

## 2. AI 对话框生命周期

请说明：

- 用户发送消息时由哪个模块接收；
- 当前 project/screen 如何取得；
- 当前 selection 是否可以同步取得；
- AI 请求如何组装；
- 对话 session 与工程 session 是否相同；
- AI 返回修改建议后由哪个模块执行。

建议画出：

```text
AI Chat UI
   ↓
request handler
   ↓
context / selection snapshot
   ↓
Axrail
   ↓
result / ChangeSet
   ↓
editor update
```

## 3. Canvas / Editor 架构

请说明：

- renderer 类型；
- 画布是否 iframe / canvas / SVG / DOM / WebGL / native；
- component tree 与 renderer tree 是否一一对应；
- 是否存在 preview renderer 和 design renderer 两套实现；
- editor 与 AI chat 是否同进程/线程。

## 4. 单选 / 多选 / 框选

分别说明：

### 单选

- click event：
- selection event：
- stable component ID：
- selected object 查询 API：

### 多选

- modifier key / layer panel / programmatic selection：
- event payload：
- component ID 列表：

### 框选 / Region

- rectangle/lasso 实现：
- hit testing API：
- 框选结束事件：
- 是否返回稳定 component IDs：
- 空白区域是否允许被选择：

## 5. Stable Engineering ID

请明确：

- project ID：
- screen/page ID：
- component/widget ID：
- binding/tag ID：
- ID 是否跨保存稳定：
- copy/paste 后 ID 行为：
- undo/redo 后 ID 行为：
- runtime renderer ID 是否和 engineering ID 相同：

Axrail 不应使用像素坐标替代稳定工程 ID。

## 6. Coordinate System

请说明：

- 原点；
- screen coordinates；
- world/editor coordinates；
- zoom；
- pan；
- transform；
- nested container coordinate conversion；
- width/height 单位。

需要给出如何把框选区域转换为 Axrail `SelectionBounds` 的方式。

## 7. Selected Object Context

选中 component 后，AI 至少能读取哪些信息：

- semantic/component type；
- x/y/width/height；
- style；
- text/content；
- property values；
- parent/container；
- bindings/tags；
- alarms/animations；
- permissions；
- script/expression 摘要；
- 其他工程语义。

请标注哪些字段敏感，哪些不能进入模型。

## 8. Selection Event → Axrail

建议输出：

```ts
{
  selectionId,
  providerId,
  source,
  mode,
  projectId,
  screenId,
  componentIds,
  bounds,
  timestamp
}
```

请说明：

- selectionId 如何生成；
- selection snapshot 何时冻结；
- 用户发送 AI 消息时如何取得同一时刻 snapshot；
- 如何避免 selection change 与 AI request race condition。

## 9. Project Context / Read APIs

请提供可用接口说明：

- inspect project；
- inspect screen；
- inspect component；
- query selected component properties；
- query binding/tag；
- query available component types；
- query project revision/version。

只需要接口契约和脱敏示例，不要提交私有实现源码。

## 10. Mutation APIs

请说明产品真实修改能力：

- add component；
- update component；
- move/resize；
- multi-object layout；
- update binding；
- create/remove screen；
- batch update；
- staging/edit session；
- save；
- commit。

标注哪些是原子、哪些是立即产生 durable effect。

## 11. Preview / Verify

请说明：

- 是否能 preview ChangeSet；
- preview 是否使用真实 renderer；
- 是否能获得 before/after diff；
- apply 后如何查询真实状态；
- verify 可以检查哪些后置条件。

## 12. Version / Concurrency

请说明：

- project revision/version/ETag；
- screen/component 是否单独版本化；
- concurrent edit detection；
- save conflict；
- stale selection 对象被删除后的行为。

## 13. Undo / Rollback / Compensation

请说明：

- native undo stack；
- transaction/edit session；
- rollback API；
- compensation；
- rollback 失败表现；
- process crash 后恢复能力。

据此决定 Axrail Transaction mode：

```text
atomic
compensating
best_effort
```

## 14. 推荐首个 scoped-edit 场景

请选择一个真实但低风险的 L2 工程修改：

- [ ] 框选多个组件后对齐/重排
- [ ] 修改一个选中组件的样式
- [ ] 修改选中组件属性
- [ ] 修改一个 binding
- [ ] 在框选空白区域创建组件
- [ ] 其他：

说明预计调用的产品 API。

## 15. 返回 Axrail 团队的问题与建议

- Axrail SelectionContext 哪些字段难映射？
- stable target ID 是否足够？
- region bounds 是否足够表达布局意图？
- 是否需要新的 HMI domain target type？
- Context 是否需要补充？
- ChangeSet 是否能自然表达产品 mutation？
- 哪些能力只能 degraded/unsupported？
- 建议修改的公共 API：
