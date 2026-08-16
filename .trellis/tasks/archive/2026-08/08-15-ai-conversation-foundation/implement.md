# AI 会话基础执行计划

## 1. 数据库与 contracts

- [x] 增加 conversation、message、generation schema、relations、索引和 migration。
- [x] 增加 `AI.GENERATION_ACTIVE`、`AI.GENERATION_INTERRUPTED`、`AI.RETRY_NOT_ALLOWED`、`AI.CONTEXT_LIMIT`、`AI.TOOL_NOT_FOUND`、`AI.TOOL_INVALID_ARGUMENTS`、`AI.TOOL_FORBIDDEN`、`AI.TOOL_FAILED`、`AI.TOOL_TIMED_OUT`、`AI.TOOL_CANCELLED`、`AI.GENERATION_TOOL_CALL_LIMIT`、`AI.GENERATION_TOOL_ROUND_LIMIT`、`AI.GENERATION_TOOL_TOTAL_TIMEOUT`；与现有 AI code 一起生成封闭 OpenAPI schema。
- [x] 通过临时 SQLite 执行完整 migration，验证 cascade、owner 索引和 sequence 唯一性。

## 2. API

- [x] 实现 repository 的 owner 查询、稳定分页、详情、删除和 generation 状态更新。
- [x] 实现 service 的创建、发送、重试语义、CAS 并发占用、停止、恢复和上下文限制。
- [x] 实现 JSON route、SSE route、OpenAPI schema 和错误映射。
- [x] 增加 Hono AI 会话 route 的长请求 timeout 例外，并保持所有 `/api/auth/*` 的原 10 秒 timeout。
- [x] 终态 transaction 同时更新消息、generation、会话和 active_generation_id。

## 3. Admin

- [x] 增加 `/ai/chat` 路由、导航、i18n、API adapter 和 Query hooks。
- [x] 实现会话列表、创建、删除、消息历史、模型选择、发送、停止、重试和错误状态。
- [x] 处理刷新恢复、旧 generation、切换会话、移动 Drawer 和长文本布局。

## 4. 测试

- [x] API 覆盖 owner 隔离、连续多轮、上下文超限、并发发送 CAS、停止、断开、恢复、retry 链不重复 user 和删除竞态。
- [x] 动态工具 Context 上限和工具终态矩阵明确由依赖任务 `ai-tool-execution-foundation` 在加入 orchestrator 后验证；本任务不注册生产工具。
- [x] Admin 覆盖 loading、empty、error、pending、旧 stream、刷新和移动布局。
- [x] 覆盖 SSE 前 HTTP 状态、SSE 后唯一 terminal event、generation/model 终态和 stop/retry 语义矩阵。
- [x] marker 测试确认完整 tool arguments/result 不会直接序列化到会话 DTO、tool activity、审计 API 或日志；不要求模型生成文本完全不复述测试 marker。
- [x] 运行 `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm --filter @starter/api db:check`。
- [x] 浏览器验证桌面和 390px：创建、刷新恢复、空消息、无模型、移动 Drawer 均无页面级横向溢出。

## 5. 回滚点

先完成 migration 和 API，再接入 Admin 路由。页面失败时隐藏 `/ai/chat` 入口不影响旧 AI 设置和 Provider 管理；API 旧测试 route 不依赖会话表。
