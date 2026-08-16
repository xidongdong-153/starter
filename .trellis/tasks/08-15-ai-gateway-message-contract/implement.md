# AI Gateway 消息契约执行计划

## 1. 代码步骤

- [x] 在 `packages/contracts/src/ai.ts` 增加公开消息、文本内容、脱敏工具活动、公开事件和 usage/cost schema。
- [x] 在 `apps/api/src/infra/ai/` 增加项目内部 model message、工具和 Gateway runtime 类型，不导出 SDK 类型。
- [x] 复用现有 AI error code，并保持 contracts、OpenAPI 和错误映射一致。
- [x] 扩展 `apps/api/src/infra/ai/ai-gateway.ts` 输入和事件类型。
- [x] 在 infra 内实现 project DTO 到 SDK Context/Tool/Message 的单向转换。
- [x] 处理 SDK text/tool/done/error 事件、turnIndex、contentIndex、blockId、有序 final assistant message、usage/cost 和 abort；错误投影保留安全的部分 usage/cost。
- [x] 让 `ai.service.ts` 通过兼容适配调用新 Gateway，保持 `/api/ai/test` 原有 SSE。
- [x] 增加 Gateway faux Provider 测试和旧 API 回归测试。

## 2. 检查

- [x] contracts、API 类型检查、Lint、Format 通过。
- [x] `ai.smoke.test.ts` 和 Admin SSE 测试通过。
- [x] `toolcall_end` 后接 error/deferred/aborted 时不产出 `tool_call_completed`；本任务未注册 handler 或 tool audit。
- [x] 测试确认 thinking、raw error、partial SDK message 和 SDK cost 明细没有进入项目事件。
- [x] `pnpm --filter @starter/api db:check` 未因本任务产生变化。

## 3. 回滚点

如果新事件映射无法保持旧 SSE，保留新 infra mapper 但暂不切换 `prepareTest()`；修正 contracts 和 mapper 后再接入业务层。
