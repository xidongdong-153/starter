# AgentSession API 实施计划

## 前置条件

- S1、S2、S3 已完成并归档。
- Session Store、contracts、`ai_agent_sessions` 和 AgentDefinition 查询能力已存在。
- 启动前核对 S1-S3 的 `task.json.status`、实际导出、migration 和测试结果；发现与共享契约不一致时停止。

## 执行步骤

### 1. Repository 与 Presenter

- [x] 实现按 owner 创建、列表、详情、更新和归档。
- [x] 默认排除 archived record。
- [x] 按共享契约实现 Pi transcript 到四分支公开 DTO 的中性投影，过滤 `starter.run.v1` 和未知 entry。

### 2. Service

- [x] 验证 defaultAgentId。
- [x] 实现 Pi create -> 主库 insert -> 失败补偿。
- [x] 实现 owner 范围内的读取、修改和归档。
- [x] 实现 transcript lane 和 cursor 参数。
- [x] 实现只读 orphan 检查。

### 3. Route

- [x] 增加六个 Session endpoint 和 OpenAPI schema。
- [x] 接入 Better Auth，用户 id 只来自 session。
- [x] 挂载到根 AI Route，更新 RPC type probe。

### 4. 测试

- [x] 覆盖创建成功、主库失败补偿和补偿失败日志。
- [x] 覆盖 owner 隔离、404、分页、更新和幂等归档。
- [x] 覆盖 transcript lane、升序 cursor、limit、四种 item、`starter.run.v1`/未知 entry 过滤和内部字段过滤。
- [x] 覆盖两类 orphan 的只读报告。
- [x] 确认所有测试使用临时双数据库（`createTestApp` 同时建临时 `app.db` 和 `agent-sessions.db`）。

### 5. 共存回归与质量门

- [ ] 运行旧 Conversation、Prompt 和 AgentDefinition 测试。

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

- [ ] 使用 `trellis-check` 核对跨库补偿、权限和 DTO。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- Pi create 或 delete 行为不符合 S1 port：停在 Service，先修正任务间契约。
- owner 隔离测试失败：不挂载 Route。
- 回滚不自动删除已创建 Session 数据。
