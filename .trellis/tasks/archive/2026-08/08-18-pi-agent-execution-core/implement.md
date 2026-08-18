# Pi Agent 执行核心实施计划

## 前置条件

- S1、S2、S3 已完成并归档；S4 测试仍直接传入已解析配置 fixture，不把 AgentDefinition route/service 装配纳入本任务。
- 旧 Tool Orchestrator 继续服务 Conversation。
- 启动前核对 S1/S2/S3 的 `task.json.status`、Session adapter、contracts、数据库 schema 和测试结果；发现与共享契约不一致时停止。

## 执行步骤

### 1. 定义内部 port

- [x] 定义两段式 `prepare/start`、executor input、event stream、terminal result 和 controls。
- [x] 按共享 Harness 契约定义 `ExecutorTerminalResult`、`EventSequencer` 和 `messageId/toolCallId` 关联。
- [x] 定义 Pi 类型只能出现的 adapter 边界，增加原生 `AssistantMessageEventStream` adapter；旧 `AiGatewayEvent` 不进入 Agent。
- [x] 扩展 S1 Session adapter 的可选 message entry ID 和 compaction entry 写入 port，保持 Pi 类型不离开 `infra/agent`。
- [x] 增加 event sequence、message/tool entry ID 和 terminal guard。

### 2. Active registry

- [x] 实现按 `sessionId + lane` 原子 reserve、按 runId attach/query、release 和重复清理。
- [x] attach 时解除 Executor 的 start gate；保持 Run Service 是 reserve/attach/release 唯一调用方，Executor 不隐藏 registry 生命周期。
- [x] 覆盖并发冲突和终态清理测试。
- [x] 覆盖未 attach 不得 start、重复 start、start 后 abort/steer/follow-up control 可用性。

### 3. Tool adapter

- [x] 用 `z.toJSONSchema` 生成 Pi `AgentTool.parameters`，执行前继续调用原 Zod schema parse。
- [x] 接入 required permission、timeout、Run deadline 和 AbortSignal，所有失败返回安全文本与稳定状态。
- [x] 映射 Pi Tool result、progress 和 lifecycle event，只暴露 `safeSummary`，不暴露 arguments/modelText/details。
- [x] 确认旧 Orchestrator 没有参与新执行路径，并覆盖每次 Tool 只有一条审计记录。

### 4. Stream 与审计

- [x] 在现有 Gateway/`Models` Provider 边界上增加原生 Pi stream function，不把旧 `AiGatewayEvent` 重新拼成 Agent loop。
- [x] 保留模型策略、credential、provider env、timeout 和取消；native stream failure 必须编码为 Pi `error`/`aborted` event。
- [x] 每轮创建并完成一条只写 `runId` 的模型审计；compaction 摘要调用也使用同一审计 port。
- [x] 覆盖正常、Provider 失败、timeout、abort 和审计 finalize 的幂等性。

### 5. Executor 与 Session

- [x] 使用 Pi Agent 运行文本和多轮 Tool，`maxTurns` 通过 Pi Agent 生命周期控制。
- [x] 读取 lane branch context，按事件顺序写 user/assistant/Tool/compaction entries；预生成 message ID，且不写 `starter.run.v1`。
- [x] 接入 Pi `estimateContextTokens`、`shouldCompact`、`prepareCompaction` 和 `compact`；失败时 Run 失败且原 transcript 保留。
- [x] 映射 message/tool HarnessEvent，使用 caller 的 sequence；terminal event 的唯一性由 S6 集成测试验证。

### 6. 回归与质量门

- [x] 运行旧 Conversation 和 Tool 测试，确认两条执行路径互不调用。

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
git diff --check
```

- [x] 使用 `trellis-check` 检查事件、审计、Session 和资源清理。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- Pi 类型或行为与 research 不一致：停在失败 API，不换成自写 loop。
- Tool schema 无法安全转换：停在 Tool adapter，不降低 Zod 校验。
- 审计失败：不挂接后续 Run Route，旧审计路径保持不变。
