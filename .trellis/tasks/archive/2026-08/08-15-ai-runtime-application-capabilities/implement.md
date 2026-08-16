# AI runtime 与应用能力执行计划

## 1. 实施顺序

- [x] 完成 `ai-gateway-message-contract`，先定义项目消息、工具、usage/cost 和流事件。
  - Gateway 多消息/工具/usage/cost/timeout/abort 与 `/api/ai/test` 兼容，`ai-gateway.test.ts` 全过。
- [x] 完成 `ai-conversation-foundation`，新增会话、消息、generation 表、API 和 `/ai/chat` 页面。
  - schema/migration/repository/service/route/recovery 与 Admin `/ai/chat` 完成，浏览器验证过桌面与 390px。
- [x] 完成 `ai-usage-audit`，新增 model call/tool execution 表、权限、API 和设置页。
  - 审计契约、权限 `ai.usage.read`、表、repository/presenter/coordinator、读取 API 与 Admin `/settings/ai/usage` 完成。
- [x] 完成 `ai-tool-execution-foundation`，接入测试工具注入、执行预算、会话消息和审计。
  - registry/orchestrator 完成，13 个测试用例全过，装配进 `ai.route.ts`。
- [x] 完成 `ai-provider-smoke`，增加独立 `ai:provider-smoke` 命令和脱敏 runner。
  - runner 与 5 个测试用例完成，真实上游未执行（无凭据）。
- [x] 父任务集成检查：旧模型测试、多轮会话、停止、工具循环、审计终态、用户隔离和敏感信息扫描。
  - 见下方集成验收与门禁记录。

## 2. 共享检查点

每个子任务完成后依次运行相关包检查：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
```

涉及数据库时额外运行：

```bash
pnpm --filter @starter/api db:check
```

所有子任务完成后运行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

门禁记录（2026-08-15）：API 22 files/197 tests 通过；Admin 15 files/95 tests 通过（`--no-file-parallelism`，全量并发下两个既有 flaky 与本任务无关）；`pnpm lint`、`pnpm format:check`、`pnpm check-types`（含 build）、`pnpm --filter @starter/api db:check`、`git diff --check` 全部通过。

## 3. 集成验收

- [x] 旧 `POST /api/ai/test` 的请求、SSE 事件和错误 code 保持兼容。
  - `ai.smoke.test.ts` 逐帧断言 SSE 事件数量、顺序和终态字段。
- [x] 用户 A 无法读取用户 B 的会话、generation、消息和停止接口。
  - `ai-conversations.smoke.test.ts` owner 隔离用例；owner 条件下沉到 repository 查询。
- [x] Provider/model 选择仍由 AI service 统一校验，Gateway 不自行回退模型。
  - `resolveAllowedModel` 校验白名单与默认解析，Gateway 只消费 `AiModelRef`。
- [x] 会话 SSE 的 start、text delta、tool activity、done、error、aborted 都能驱动数据库终态和 Admin 状态。
  - generation 终态由 active generation CAS 与条件更新保护，Admin 用 generation token 隔离旧流。
- [x] 返回 `tool_use` 的 model call 以 succeeded 结束；工具失败只更新 tool execution 和 generation 终态。
  - orchestrator 的 finish 状态机与审计写入测试覆盖。
- [x] tool call 只在完整调用和项目 schema 校验通过后执行。
  - `assertToolCallMetadata`、参数 schema 校验、权限检查在 handler 执行前。
- [x] 一次用户发送产生的多轮 model call 可通过 request ID、generation ID 查询。
  - `ai_model_calls` 保存 requestId/generationId，读取 API 支持筛选。
- [x] 审计表、审计 API、日志没有 prompt、response、secret、原始错误和工具参数；会话表只有文本与脱敏工具活动。
  - 审计/工具日志白名单字段，测试断言敏感 marker 不出现。
- [x] 真实 smoke 使用正式 runtime/Gateway，但不写产品调用审计；默认 CI 不读取真实 Provider 环境变量。
  - `ai-provider-smoke.test.ts` 断言无审计行；smoke 变量独立 schema，常规 test/build 不读取。
- [x] Admin 桌面和 390px 移动视口无页面级横向溢出。
  - conversation-foundation 实施记录：浏览器验证创建、刷新恢复、空消息、无模型、移动 Drawer 均无横向溢出。

## 4. 风险与回滚点

- Gateway 事件字段不稳定：先补 infra 单元测试，再让会话和审计消费；不要让业务层读取 SDK event。
- 长 SSE 仍被 5 秒 middleware 截断：先修改 timeout 路由例外并补回归测试，再实现聊天页面。
- migration 之间的外键顺序错误：每个子任务使用临时 SQLite 执行完整 migration 后再继续。
- 审计写入失败影响主响应：审计 coordinator 必须捕获 begin/finalize 异常并只写安全日志。
- 工具 handler 取消后仍有副作用：第一阶段只使用测试注入工具，生产 registry 为空。
- 真实 Provider 无凭据：只跳过手动 smoke，不把真实调用替换成默认测试路径。
