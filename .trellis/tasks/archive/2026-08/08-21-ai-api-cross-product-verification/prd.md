# 验证 AI 基座跨产品运行契约

## Goal

在不依赖 Admin 页面、Admin API 封装或 Admin reducer 的前提下，用一个非 Admin 产品后端调用样例验证 AI API 基座。该任务是 API 父任务完成和 Web Chat 启动前的门禁。

## Dependencies

- 前置：`08-21-ai-api-contract-surface`、`08-21-ai-api-principal-scope`、`08-21-ai-api-runtime-resource-scope`、`08-21-ai-tool-package-contract`。
- 后置：`08-21-admin-ai-control-plane-only`、`08-21-web-ai-chat-consumer-validation`。

## Requirements

- 提供一个只使用公开 HTTP/OpenAPI/contracts 的调用样例；不得 import `apps/admin`。
- 使用 product app credential 调用运行面，携带 `externalUserId` 和可选 subject，不携带可覆盖 scope 的 tenant/project。
- 覆盖 Session create/get、Run start、SSE event parse、terminal event、Run get、Transcript read。
- 覆盖 abort 或至少验证取消接口的权限和状态边界。
- 模拟 SSE 任意 chunk 边界、heartbeat、提前断开和重连后的 Run snapshot/Transcript 恢复。
- 验证不同 app scope、不同 externalUserId 不能读取或控制彼此资源。
- 验证 Admin-only Provider/Agent/Usage 字段、Provider secret、Pi type 和内部错误不会进入运行响应。
- 验证 Tool package 至少有一个成功、invalid args、forbidden、timeout 或 abort 结果。
- 记录当前单进程 active registry、Pi SQLite 和 SSE 队列限制，不把样例描述成多节点服务。

## Acceptance Criteria

- [ ] 非 Admin 调用样例可以创建 Session、启动 Run、解析 HarnessEvent 并读取终态/Transcript。
- [ ] 断流不被当成 Run failed，重新查询能得到 live 或最终 Transcript。
- [ ] sequence 单调、terminal event 唯一、事件字段通过公共 schema。
- [ ] scope 越权返回安全错误，不泄露资源存在性。
- [ ] 样例不依赖 Admin private API、页面、组件或 reducer。
- [ ] 敏感信息扫描通过，Tool 安全错误和审计边界符合 contract。
- [ ] API 全量质量检查通过，结果记录到任务验证清单。

## Non-goals

- 不实现 Web 页面。
- 不实现通用 SDK、远程 Tool、Workflow、队列或独立部署。
- 不把测试样例升级成生产产品业务。

## Evidence

- `packages/contracts/src/ai.ts`
- `apps/api/src/modules/ai/run/`
- `apps/api/src/modules/ai/session/`
- `apps/api/src/infra/agent/`
- `apps/api/src/test/ai-agent-runs.test.ts`
- `apps/api/src/test/ai-agent-sessions.test.ts`
- `apps/api/src/test/ai-harness-contracts.test.ts`
- `test-fixtures/harness-timeline-isomorphism.json`
