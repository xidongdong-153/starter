# API Runtime 与控制面

## Goal

将数据库中的自定义 Provider definition 转换为 `pi-ai` Provider，支持三类协议，并提供完整 Admin 控制 API。

## Scope

- `apps/api/src/infra/ai/`：mutable Models 集合、custom Provider factory、protocol adapter、启动恢复、热加载、URL guard。
- `apps/api/src/modules/ai/configuration/`：CRUD/check/state/credential/models route、service、repository、presenter、OpenAPI。
- 复用现有 CredentialStore、ModelsStore、Gateway、Pi native stream、权限和审计。
- 不实现 Admin 页面。

## Requirements

- 固定协议映射到固定 `pi-ai` API implementation：OpenAI Completions、OpenAI Responses、Anthropic Messages。
- 禁止从数据库读取模块路径、脚本、npm 包或任意 header/body 模板。
- 自定义 Provider 与内置 Provider 同时存在，ID 冲突拒绝。
- 启动时单条坏 definition 隔离，不阻断 API；请求时返回安全错误。
- 配置变更自动停用并要求重新 check；成功 check 的 revision 才能启用。
- 支持手工模型目录；模型 schema 严格验证。
- URL 校验、DNS/IP、redirect、timeout、response size、模型数量和 JSON 深度限制统一应用于 check/refresh/request。
- 所有公开响应和日志不得包含 secret、原始上游错误、完整 URL query secret 或 Provider payload。
- 删除前处理 Agent 引用，删除后清理模型白名单和默认模型。

## Acceptance Criteria

- [x] API 重启后自定义 Provider 可恢复并出现在统一 Provider 列表。
- [x] 三类协议各有成功 stream 和 auth/timeout/upstream 失败测试。
- [x] 自定义 Provider 可创建、更新、credential、check、enable/disable、model replace、delete。
- [x] 模型测试和 Agent Run 都能解析自定义模型并写现有审计。
- [x] 内置 Provider 行为和既有测试不回归。
- [x] SSRF、非法协议、重定向和过大响应被拒绝。
- [x] 权限、错误码、OpenAPI、secret filtering 测试通过。

## Dependencies

- 必须等待 Child 1 的 contracts/schema/repository 完成。
- Child 3 必须等待本任务 OpenAPI/RPC 类型稳定。
- Child 4 等本任务完成后做真实跨层验证。

## Verification

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test -- src/test/ai-custom-provider.test.ts src/infra/ai/ai-custom-provider.test.ts
pnpm --filter @starter/api db:check
```
