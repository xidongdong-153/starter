# Pi Agent 执行核心实施计划

## 前置条件

- S1 和 S2 已完成并归档。
- S3 可以未完成；测试直接传入已解析配置 fixture。
- 旧 Tool Orchestrator 继续服务 Conversation。
- 启动前核对 S1/S2 的 `task.json.status`、Session adapter、contracts、数据库 schema 和测试结果；发现与共享契约不一致时停止。

## 执行步骤

### 1. 定义内部 port

- [ ] 定义两段式 `prepare/start`、executor input、event stream、terminal result 和 controls。
- [ ] 按共享 Harness 契约定义 `ExecutorTerminalResult`、`EventSequencer` 和 `messageId/toolCallId` 关联。
- [ ] 定义 Pi 类型只能出现的 adapter 边界。
- [ ] 增加 event sequence 和 terminal guard。

### 2. Active registry

- [ ] 实现按 `sessionId + lane` 原子 reserve、按 runId attach/query、release 和重复清理。
- [ ] 保持 Run Service 是 reserve/release 唯一调用方，Executor 不隐藏 registry 生命周期。
- [ ] 覆盖并发冲突和终态清理测试。
- [ ] 覆盖未 attach 不得 start、重复 start 和 start 后 control 可用性。

### 3. Tool adapter

- [ ] 转换 Zod schema，执行前继续 parse。
- [ ] 接入 required permission、timeout 和 AbortSignal。
- [ ] 映射 Pi Tool result 和 lifecycle event。
- [ ] 确认旧 Orchestrator 没有参与新执行路径。

### 4. Stream 与审计

- [ ] 包装现有 Gateway 为 Pi stream function。
- [ ] 保留模型策略、credential、timeout 和取消。
- [ ] 每轮创建并完成一条 runId 审计。
- [ ] 覆盖正常、Provider 失败、timeout 和 abort。

### 5. Executor 与 Session

- [ ] 使用 Pi Agent 运行文本和多轮 Tool。
- [ ] 读取 lane context，写 user/assistant/Tool/compaction entries；不写 `starter.run.v1`。
- [ ] 接入 Pi compaction 判断和实现。
- [ ] 映射 message/tool HarnessEvent，使用 caller 的 sequence；terminal event 的唯一性由 S6 集成测试验证。

### 6. 回归与质量门

- [ ] 运行旧 Conversation 和 Tool 测试，确认两条执行路径互不调用。

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
git diff --check
```

- [ ] 使用 `trellis-check` 检查事件、审计、Session 和资源清理。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- Pi 类型或行为与 research 不一致：停在失败 API，不换成自写 loop。
- Tool schema 无法安全转换：停在 Tool adapter，不降低 Zod 校验。
- 审计失败：不挂接后续 Run Route，旧审计路径保持不变。
