# AgentSession API

## Goal

实现 AgentSession 的业务索引、用户归属、Pi Session 协调、transcript 投影和 HTTP API。用户可以创建、查询、修改和归档自己的 Session，但本任务不启动 AgentRun。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S5，前置任务是 S1 `08-18-pi-session-storage-foundation`、S2 `08-18-agent-harness-contracts-schema` 和 S3 `08-18-agent-definition-management`。

本任务直接使用父任务共享契约和 S2 导出的 Session、transcript、lane、cursor schema：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。

Session 的完整历史由 Pi 保存，Starter 主库只保存鉴权和列表需要的索引。两个数据库没有跨库 transaction，需要明确创建补偿和只读一致性检查。

## Requirements

### R1. Session 子域

- 在 `modules/ai/session/` 增加 openapi、presenter、repository、route 和 service。
- 主库保存 id、ownerId、title、defaultAgentId、archivedAt、createdAt 和 updatedAt。
- Session id 与 Pi Session id 使用同一个 UUID。
- defaultAgentId 可空；非空时必须引用可用 AgentDefinition。
- 主库不保存 message、Tool result、lane tree 或完整 transcript。

### R2. 创建与归档

- 创建顺序为生成 id、创建 Pi Session、写主库索引。
- 主库写入失败时删除刚创建的 Pi Session；补偿失败必须记录 sessionId 和 cause。
- DELETE 只归档主库索引，不立即物理删除 Pi history。
- 已归档 Session 不允许修改或启动新 Run；读取策略按 design 固定。

### R3. API 与权限

- `POST /api/ai/sessions`
- `GET /api/ai/sessions`
- `GET /api/ai/sessions/{sessionId}`
- `PATCH /api/ai/sessions/{sessionId}`
- `DELETE /api/ai/sessions/{sessionId}`
- `GET /api/ai/sessions/{sessionId}/transcript`
- 所有 Route 要求登录，只能访问当前用户自己的 Session。
- 访问他人或不存在的 Session 统一返回 `COMMON.NOT_FOUND`。

### R4. Transcript

- transcript 按 lane 和 cursor 分页读取，由 Presenter 把 Pi entries 投影为 contracts DTO。
- 不返回 Pi metadata、内部 record、数据库路径或 Provider secret。
- 第一版默认 lane 为 `main`，lane 输入必须通过 contracts 校验。
- 本任务允许 transcript 为空；Run message 和 Tool 活动由 S6 写入。

### R5. 一致性检查

- 提供只读检查能力，识别主库索引缺少 Pi Session 和 Pi Session 缺少主库索引。
- 检查不自动删除或修复数据。
- API bootstrap 不因 orphan 自动失败，但记录结构化日志。

## Acceptance Criteria

- [ ] 创建 Session 后主库和 Pi DB 使用同一 id。
- [ ] 主库写入失败时 Pi Session 被补偿删除；补偿失败有日志测试。
- [ ] 用户只能列表和读取自己的 Session，不能通过 id 探测他人资源。
- [ ] title 和 defaultAgentId 更新通过校验，归档操作幂等。
- [ ] 已归档 Session 不出现在默认列表，也不能继续修改。
- [ ] transcript 支持 lane、cursor 和 limit，DTO 不包含 Pi 内部字段。
- [ ] 只读一致性检查能报告两类 orphan，不修改数据库。
- [ ] 旧 Conversation API 和数据保持通过。
- [ ] 全仓质量门、测试、构建和数据库检查全部通过。

## Out of Scope

- AgentRun、SSE、abort、steer、follow-up 和并发控制。
- Session fork、navigate、全文搜索和物理清理。
- Admin Session 调试页面。
- 旧 Conversation 数据导入或删除。
