# PRD：startRun 支持内联 Agent 配置

## 背景

当前 AI 服务的执行能力两头有、中间空：

- `POST /api/ai/completions` 是裸模型调用，没有工具、技能、思考强度、输出契约。
- 带 Agent 的完整执行必须先在管理端创建 `ai_agent_definitions`，revision 化、启停由 Admin 管。
- Web 示例 Flow 的节点只能填 `agentId`，编排表达力等于预定义 Agent 的数量；想"节点 A 用一个模型出大纲、节点 B 换模型带工具重写"，得先去 Admin 建多个 Agent。

结论（两轮讨论确认）：API 该提供"一次可内联配置的 Agent 执行"作为原子能力，Agent 定义降格为命名预设，Flow 节点直接消费原子能力。本任务做原子出口的最小版本。

## 目标

1. `POST /api/ai/sessions/{sessionId}/runs` 接受可选 `config` 字段：与 `agentId` 二选一。内联配置包含模型、系统提示词（内联文本或引用）、工具、技能、思考强度、maxTurns、输出契约。
2. 内联启动的 Run 走现有执行链路：事件流、快照、幂等、审计、abort/steer/followUp 与 Agent 启动的 Run 同构。
3. Flow 示例的 agent 节点支持两种模式：预设 Agent（现状）或自定义配置（本任务新增）。

## 非目标（明确不做，防止任务膨胀）

- 不做 Agent 定义的 `modelPolicy`（locked/allowlist）治理策略，留后续任务。
- 不做用户偏好记忆（`user_ai_preferences` 写入 Web Chat / Flow），留后续任务。
- 不做 Flow 文档服务端化、DAG 引擎、分支并发，保持前端驱动执行。
- 不做 Web Chat 页面的模型选择 UI（Chat 继续只用 AgentSelect）。
- 不做 Admin 端内联 Run 的专属页面（Admin 不提供 Run 浏览页，现状不变）。
- 不给 `product_app` 主体开放内联配置（见约束 5），也不做 App 级开关。

## 验收标准

### API 契约与校验

1. `startAgentRunSchema` 新增可选 `config`；`agentId` 与 `config` 同传返回 400。
2. 两者都不传时维持现状：回落 `session.defaultAgentId`，无默认返回现有 400 错误。
3. `config.model` 必须命中 `ai_enabled_models` 且 Provider 可用，否则返回 `AI_MODEL_NOT_ALLOWED`（403），与 completion 模块同语义。
4. `config` 的工具引用必须存在于 Tool 注册表且对该主体 scope 可用；技能必须启用；输出契约必须命中注册表且元数据一致。校验失败返回 `AI_AGENT_CONFIG_INVALID`（400）。
5. `product_app` 主体携带 `config` 启动 Run 返回 403；`starter_user` 正常。
6. 系统提示词二选一必填：内联文本 `systemPrompt` 或引用 `systemPromptId`，同传或全空返回 400。

### 执行与持久化

7. 内联 Run 的 `snapshot_json` 记录实际生效配置（schemaVersion 3，`agentId`/`agentRevision` 为 null）；steer/followUp 从快照回读模型、附件图片校验照常工作。
8. `ai_model_calls` 审计照常落库，`scenario` 仍为 `agent_run`，provider/model 为内联配置实际值。
9. 幂等键行为不变：同 key 重放返回既有 Run。
10. 旧 Run（v2 快照、agentId 非空）的读取接口（Run 详情、transcript、事件流）不受影响。

### Flow 示例

11. Agent 节点 Inspector 提供"预设 Agent / 自定义配置"模式切换；自定义模式可配模型、思考强度、系统提示词、maxTurns、工具、技能。
12. 模型下拉数据来自 `GET /api/ai/models`；工具列表来自新增的 `GET /api/ai/tools`；技能列表来自 `GET /api/ai/skills`。
13. 运行前校验：自定义节点必须有模型与系统提示词，缺失时给出可读错误并阻止启动。
14. 旧 localStorage Flow 文档（无 `config` 字段）可正常打开、编辑、运行。

### 质量

15. `pnpm check`（类型、Lint、Format）与 `pnpm test` 全部通过；新增 API 测试覆盖上述 1-10 条中可自动化验证的行为。

## 约束

- 契约 schema 全部 `strictObject`，未知字段直接拒绝。
- 数据库迁移走 Drizzle `db:generate` 流程，编号 0027，SQLite 表重建由 drizzle-kit 生成。
- 快照读取必须同时接受 schemaVersion 2 与 3，存量数据不能失效。
- 不引入新的共享依赖。
