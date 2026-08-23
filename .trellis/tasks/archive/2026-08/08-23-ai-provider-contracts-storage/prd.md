# Contracts 与数据库定义

## Goal

为三类自定义 Provider 建立跨层 contracts、数据库 definition 存储和严格校验，让 API runtime 与 Admin 使用同一份协议。

## Scope

- `packages/contracts/src/ai.ts`：Provider kind/protocol、compat、模型定义、创建/更新/删除/检查 DTO。
- `apps/api/src/modules/ai/ai.schema.ts`：新增 `ai_custom_providers` 表和关系。
- Drizzle migration、definition repository、schema/repository tests。
- 不实现 `pi-ai` runtime、HTTP route 和 Admin 页面。

## Requirements

- 协议只允许 `openai-completions`、`openai-responses`、`anthropic-messages`。
- 兼容配置按协议使用严格白名单，禁止任意 JSON key。
- Provider ID 不能覆盖内置 ID；repository 层必须再次检查，不能只依赖 route schema。
- URL、模型 ID、名称、能力、成本、模型数量和字符串长度有明确上限。
- secret 字段只能作为写入输入，不进入 response DTO 或 definition JSON。
- 更新使用 revision/CAS；删除操作提供事务内的模型引用和默认模型清理接口。
- 设计需兼容内置 Provider 当前表结构和既有 migration。

## Acceptance Criteria

- [ ] 三类协议的 contracts schema 可解析合法输入并拒绝非法输入。
- [ ] custom Provider definition、model definition、compat 字段均有 TypeScript 类型导出。
- [ ] 数据库 migration 可执行，`db:check` 通过。
- [ ] repository 覆盖 create/list/find/update CAS/delete、revision 和引用清理。
- [ ] JSON 无效、重复模型、超限模型、非法 URL 和冲突 ID 有稳定错误。
- [ ] 不读写 Pi Session 数据库。
- [ ] 相关 type-check、lint、format 和测试通过。

## Dependencies

- 无代码依赖，可先执行。
- Child 2 必须等待本任务 contracts/schema/repository 稳定后再接入 runtime。
- Child 3 依赖本任务最终导出的 DTO。
- Child 4 依赖本任务 migration 和 repository 测试。

## Verification

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api db:check
pnpm --filter @starter/api test -- src/test/ai-custom-provider-storage.test.ts
```
