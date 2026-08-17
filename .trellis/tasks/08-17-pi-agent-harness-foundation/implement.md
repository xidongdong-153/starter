# Starter Agent Harness 直接重构实施计划

## 当前状态

- Trellis 状态为 `in_progress`。
- 已运行 `task.py start`，并读取 API、contracts、Admin 和跨层规范。
- 未修改产品代码、安装依赖或清空数据库。
- 现有类型、Lint、Format、测试、构建和 Drizzle migration 基线均已通过。

## 完成范围

实施完成后应具备：

- Pi Agent、Session 和 SQLite backend 依赖与 bootstrap。
- AgentDefinition 管理 API 和 Admin 页面。
- AgentSession 的创建、列表、详情、修改、归档和 transcript API。
- AgentRun 的 SSE、状态、abort、steer 和 follow-up API。
- Pi event 到 HarnessEvent 的稳定映射。
- 独立 `agent-sessions.db`、Starter 主库索引和恢复检查。
- Provider、Prompt、Skill、Tool Registry、模型策略和用量审计接入。
- Admin Session/Run 调试页面。
- 旧 Conversation runtime、API、contracts、Admin 调用和数据表全部删除。

## 执行顺序

### 1. 启动任务并建立基线

- [x] 用户批准最新规划后运行：

```bash
python3 ./.trellis/scripts/task.py start 08-17-pi-agent-harness-foundation
```

- [x] 使用 `trellis-before-dev` 读取 API、contracts、admin 和跨层规范。
- [x] 记录 `git status --short`，保留用户已有改动。
- [x] 运行现有基线：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

基线失败时停止，记录原有失败，不修改无关代码。

### 2. 增加 Pi 依赖和环境配置

- [ ] 在 workspace catalog 增加 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-session-backend-sqlite-node`。
- [ ] `pi-ai`、`pi-agent-core` 和 SQLite backend 使用同一精确版本。
- [ ] 在 `apps/api/package.json` 引用新依赖。
- [ ] 增加 `AGENT_SESSION_DATABASE_PATH` 的 env schema、`.env.example` 和测试注入。
- [ ] 默认开发路径为 `apps/api/data/agent-sessions.db`，确认不会提交运行数据。
- [ ] 安装依赖并运行：

```bash
pnpm install
pnpm --filter @starter/api check-types
```

回滚点：恢复 catalog、package 和 env 文件，不触及数据库。

### 3. 直接替换 contracts

- [ ] 在 `packages/contracts/src/ai.ts` 增加 AgentDefinition、AgentSession、AgentRun、transcript 和 HarnessEvent schema。
- [ ] 增加 Harness 错误码和 event discriminated union。
- [ ] 删除全部 `AiConversation*`、generation input/DTO、Conversation SSE event 和旧错误码。
- [ ] 不导出 Pi `AgentEvent`、Session Entry、Drizzle record 或 Hono 类型。
- [ ] 给名称、title、input blocks、lane、cursor 和 config version 设置明确边界。
- [ ] 重写 contracts 测试，覆盖 event union、非法配置、secret 不可见和终态枚举。

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
```

回滚点：在数据库切换前可以恢复 contracts；切换后不承诺兼容旧客户端。

### 4. 编写并验证破坏性 Drizzle migration

- [ ] 在 `ai.schema.ts` 增加 `ai_agent_definitions`、`ai_agent_sessions` 和 `ai_agent_runs`。
- [ ] 重建 `ai_model_calls`：删除 `conversationId`、`generationId`，增加 nullable `runId` 和索引。
- [ ] 保留 Provider、模型、Prompt、Skill、Tool audit 和 usage audit 表及数据。
- [ ] 删除 `ai_generations`、`ai_conversation_messages`、`ai_conversations` 及 relations。
- [ ] 生成 migration：

```bash
pnpm --filter @starter/api db:generate
```

- [ ] 检查 migration 的外键顺序：先解除 `ai_model_calls` 的旧引用，再删除 generation、message 和 conversation 表。
- [ ] 用含旧会话数据的临时数据库运行 migration，断言：
  - 三张旧表不存在。
  - 三张新表存在且为空。
  - Provider、Prompt、Skill 和审计数据仍存在。
  - 旧 `ai_model_calls` 可保留且 `runId=null`。
- [ ] 检查 migration 不创建或修改 Pi backend 内部表。

回滚边界：migration 应用前可恢复 schema 和 migration；应用后旧 Conversation 数据不可恢复，回滚只能重新初始化空库。

### 5. 实现 Pi Session Store adapter

- [ ] 新建 `infra/agent/pi-session-store.ts`。
- [ ] 使用 `SqliteSessionRepository` 和 Node sqlite factory，不读取 Pi 私有表。
- [ ] bootstrap 提供固定 `cwd`，客户端不能传 cwd、ownerId、storage path 或任意 metadata。
- [ ] 提供 create、open、transcript、append record、lane、compaction、delete 和 close 能力。
- [ ] fork、navigate 和 search 保留为窄 port，第一版不全部导出 HTTP API。
- [ ] 使用临时双数据库测试 create/open/replay、Tool entry、custom record、writer lease、close 和数据库隔离。

回滚点：删除 adapter 和测试；不删除用户环境中的其他文件。

### 6. 实现 AgentDefinition 子域

- [ ] 新建 `modules/ai/agent/` 的 openapi、presenter、repository、route 和 service。
- [ ] Admin CRUD 管理系统 Agent，普通用户只读取 enabled Agent。
- [ ] 配置修改递增 revision，状态 endpoint 管理 draft/enabled/disabled。
- [ ] Service 解析模型、Prompt、Skill 和 Tool 引用；Presenter 删除内部字段和 secret。
- [ ] 根 `ai.route.ts` 显式挂载 Agent Route，保留 Hono RPC 类型。
- [ ] 增加权限、OpenAPI、RPC type 和 CRUD smoke tests。

回滚点：数据库切换前可以移除 Agent Route；切换后回滚需要重新初始化空库。

### 7. 实现 Pi Agent Executor

- [ ] 新建 `pi-agent-executor.ts`、`pi-event-mapper.ts` 和 `active-run-registry.ts`。
- [ ] 使用 Pi `Agent` 或 `agentLoop`，不复制旧 Tool loop。
- [ ] stream function 接入现有 AiInvocationRunner 和 Gateway，保留模型策略、超时和用量审计。
- [ ] Tool Registry 通过薄 adapter 生成 Pi `AgentTool`。
- [ ] Zod schema 使用 `z.toJSONSchema` 转为 Pi parameters，执行边界继续用原 Zod parse。
- [ ] Tool lifecycle 只写一次 `ai_tool_executions`。
- [ ] 模型请求前使用 Pi 默认 compaction 判断和执行。
- [ ] `PiEventMapper` 输出 HarnessEvent，不能把 Pi event 传到 Route 或 Admin。
- [ ] registry 强制 `sessionId + lane` 单写并提供 abort、steer、follow-up。
- [ ] 测试文本 Run、多轮 Tool、失败、abort、steer、follow-up、唯一终态、registry 清理和 compaction。

回滚点：公开 Run Route 挂载前可以整体移除 Executor。

### 8. 实现 AgentSession 和 AgentRun 子域

- [ ] 新建 `modules/ai/session/` 和 `modules/ai/run/` 的 openapi、presenter、repository、route 和 service。
- [ ] 主库只保存 Session owner/index 和 Run index/snapshot。
- [ ] Session create 使用与 Pi Session 相同的 UUID；主库写入失败时补偿删除 Pi Session。
- [ ] Session delete 归档索引，不立即物理删除 Pi history。
- [ ] transcript presenter 投影 Pi entries 和 `starter.run.v1` records。
- [ ] `startRun` 完成权限、snapshot、Run row、Session open 和 Executor 启动。
- [ ] Run Route 把 `AsyncIterable<HarnessEvent>` 写为 SSE；heartbeat 使用 comment。
- [ ] SSE 断开只停止 transport 写入，不 abort Run。
- [ ] terminal record 先写 Pi，再更新主库 Run；条件更新保证唯一终态。
- [ ] 启动时修复遗留非终态 Run。
- [ ] 增加资源归属、分页、transcript、SSE、显式 abort、并发和进程中断测试。

回滚点：旧数据表删除前可以移除新 Route；删除后只能回到空库状态。

### 9. 删除旧 Conversation runtime 并切换 API

- [ ] 从 `ai.route.ts` 移除 Conversation Route，挂载 Agent、Session 和 Run Route。
- [ ] 删除 `modules/ai/conversation/`。
- [ ] 删除 `tool/tool-orchestrator.ts`，保留 Tool Registry、handler 和 Pi adapter。
- [ ] 删除 Conversation 专用 bootstrap 装配、controller map、generation 恢复和旧 SSE helper。
- [ ] 删除旧 OpenAPI operation、RPC type probe 和 smoke tests，改成 Harness 对应检查。
- [ ] 搜索并清理全部 Conversation 类型、path、error code 和 import。
- [ ] 在临时数据库完整验证后，对明确的开发库运行 destructive migration；执行前输出数据库绝对路径和旧三表记录数，不创建备份。
- [ ] 初始化空的 `agent-sessions.db`。

```bash
pnpm --filter @starter/api db:migrate
pnpm --filter @starter/api db:check
```

回滚边界：此步骤后旧会话数据不可恢复。恢复旧代码也只能配合重新创建的空旧 schema，不能恢复原记录。

### 10. 同步改造 Admin

- [ ] 在 `apps/admin/src/api/ai/` 增加 Agent、Session 和 Run 请求函数及 query hooks。
- [ ] 删除 create/get/delete Conversation、retry generation、stop generation 和旧 stream reducer。
- [ ] query keys 从 conversations 改为 agents、sessions 和 runs。
- [ ] 新增 AgentDefinition 管理页面。
- [ ] 用 Session/Run 调试页面替换 `AiConversations.tsx`，路由和导航名称改为 Agent Sessions。
- [ ] 页面支持创建 Session、选择 Agent、启动/停止 Run、显示 transcript、Tool 活动和终态错误。
- [ ] 更新中英文文案，删除 Conversation/generation 专用文案。
- [ ] 重写 `ai-api`、`ai-query`、`ai-conversations` 和管理页面测试。
- [ ] Admin 不保存 transcript 业务副本；TanStack Query cache 和页面 state 只作 UI 状态。

回滚点：API contracts 已破坏性切换，Admin 必须在同一个提交内完成，不能发布一半。

### 11. 补一致性检查和生命周期关闭

- [ ] bootstrap 初始化 Pi Session Repository、Executor 和 active registry。
- [ ] 关闭时停止新 Run、等待或 abort active Run、drain write、关闭 Pi Repository，再关闭主库。
- [ ] 增加只读一致性检查：主库孤儿索引、Pi 孤儿 Session、无 active handle 的非终态 Run。
- [ ] 修复命令必须显式指定动作，不默认删除新 Session 数据。
- [ ] 更新 `.env.example`、README 和 AI 架构规范中的真实路径、命令和限制。

### 12. 静态删除检查

```bash
rg -n '/api/ai/conversations|AiConversation|ai_conversations|ai_conversation_messages|ai_generations' apps packages
rg -n 'conversation\.service|conversation\.repository|tool-orchestrator' apps/api/src
rg -n 'AgentEvent|SessionEntry|SqliteSession' packages/contracts/src
rg -n 'AgentHarness' apps/api/src
```

预期：

- 前两条没有产品代码匹配；migration 历史允许出现旧表名。
- contracts 不出现 Pi 内部类型。
- 产品代码不实例化当前未实现的 `AgentHarness`。

### 13. 全量验证

按质量门顺序运行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
```

然后运行：

```bash
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

- [ ] API 测试同时注入临时 `app.db` 和 `agent-sessions.db`。
- [ ] migration 测试证明旧数据被清空且配置数据保留。
- [ ] Admin 构建证明新 RPC/contracts 已完整接入。
- [ ] 不修改或删除实际开发库以外的数据库文件。

### 14. 完成前评审

- [ ] 使用 `trellis-check` 核对 PRD、design、数据删除、API、Admin、测试和依赖边界。
- [ ] 使用 `trellis-update-spec` 记录已经实现并验证的 Harness 规则。
- [ ] 再运行 Format 检查。
- [ ] 汇总删除的数据、旧文件、新 migration、验证结果和已知限制。
- [ ] 未经用户确认，不执行 `git commit`、`git push` 或任务归档。

## 验收映射

| 验收点 | 实施步骤 |
| --- | --- |
| 复用 Pi Agent 和 Session | 2、5、7 |
| AgentDefinition、Session、Run API | 3、6、8 |
| 独立 Session DB | 2、5、8、11 |
| 稳定 HarnessEvent | 3、7、8 |
| 清空旧 Conversation 数据和表 | 4、9、13 |
| 删除旧 runtime 和 contracts | 3、9、12 |
| Admin 完整切换 | 10、13 |
| Provider、Prompt、Skill、Tool、审计保留 | 4、7、13 |
| 群聊和 Graph 可适配 | design 评审；本任务不实现产品层 |
| 全量质量检查 | 12、13、14 |

## 明确不在本任务执行

- 旧 Conversation 数据迁移、导出、备份或恢复。
- Conversation facade、legacy route 或双写。
- Web 聊天产品、好友、群聊和房间。
- React Flow、LangGraph、Graph schema 和 checkpoint。
- 多进程 queue、event broker 和 SSE delta replay。
