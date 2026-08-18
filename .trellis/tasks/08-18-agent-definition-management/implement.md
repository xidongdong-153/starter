# AgentDefinition 管理实施计划

## 前置条件

- S2 已完成并归档。
- `ai_agent_definitions` 和 Agent contracts 已存在。
- 旧 Conversation runtime 保持可用。
- 启动前核对 S2 的 `task.json.status`、contracts 实际导出、migration 和测试结果；不按未实现的规划字段继续。

## 执行步骤

### 1. Repository 与 Service

- [ ] 新建 AgentDefinition repository 和 record 类型。
- [ ] 实现创建、分页列表、按 id 查询、更新和状态修改。
- [ ] 实现结构化 config 比较和 revision 规则。
- [ ] 复用模型、Prompt、Skill 和 Tool Registry，构建 resolver。
- [ ] 实现无 secret snapshot。
- [ ] 更新 Prompt 引用检查，同时覆盖旧 Conversation 和 AgentDefinition。

### 2. Route 与 Presenter

- [ ] 定义公开 enabled Agent 列表和详情 Route。
- [ ] 定义 Admin 列表、创建、更新和状态 Route。
- [ ] 接入 `requireAuth`、`ai:config:read` 和 `ai:config:manage`。
- [ ] 在根 AI Route 显式挂载，保持 Hono RPC 类型可推导。
- [ ] 更新 OpenAPI 和 RPC type probe。

### 3. API 测试

- [ ] 覆盖 CRUD、revision、状态和重复更新。
- [ ] 覆盖无效模型、Prompt、Skill 和 Tool。
- [ ] 覆盖普通用户、read 权限和 manage 权限。
- [ ] 断言所有 DTO 和 snapshot 不含 secret。
- [ ] 覆盖 Prompt 被旧 Conversation 或 Agent 引用时不能删除。

### 4. Admin 管理页

- [ ] 增加 Agent API client、query keys、queries 和 mutations。
- [ ] 新增 Agents 页面、路由和导航项。
- [ ] 实现列表、创建、编辑和状态操作。
- [ ] 使用现有模型、Prompt、Skill 和 Tool 查询生成表单选项。
- [ ] 增加中英文文案和页面测试。

### 5. 共存回归

- [ ] 运行旧 Conversation API 和 Admin 页面测试。
- [ ] 确认 Agent query key、Route 和文案不替换旧对象。

### 6. 质量门

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

- [ ] 使用 `trellis-check` 核对 API、Admin 和权限。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- Resolver 不满足现有资源接口：停在 Service，不修改旧资源语义。
- Admin 表单失败：保留已通过测试的 API，但任务不视为完成。
- 回滚不删除 S2 的表或 contracts。
