# AI Principal/Scope 实施计划

## 阶段 1：内部类型和 adapter

- [x] 新建 AI 认证上下文模块，定义 `PrincipalContext`、`ResourceScope`、错误分类和 adapter 接口。
- [x] 把 Better Auth `currentUserId` 映射到 Starter compatibility scope。
- [x] 为 route/service 写单元测试，证明 service 不接受未解析 scope。

## 阶段 2：应用凭据存储和 Admin API

- [x] 增加 app credential schema、migration、repository、hash/verify 工具。
- [x] Admin create 请求填写并校验不可变 tenantId/projectId；list/detail 返回 scope，但不返回 secret。
- [x] 增加 Admin create/list/rotate/revoke route、schema、presenter 和审计。
- [x] rotate 只能更换 secret；尝试更换 tenant/project 必须拒绝，scope 变更走 revoke + create。
- [x] 创建/轮换只返回一次 secret；list/detail 只返回 prefix、scope、status、时间和 lastUsedAt。
- [x] 增加 active/revoked、重复请求、权限和 secret marker 测试。

## 阶段 3：Product app middleware

- [x] 增加应用凭据认证 middleware，解析 `Authorization: Bearer`。
- [x] 从凭据派生固定 tenant/project；请求不接受 tenant/project scope 字段。
- [x] 解析 `externalUserId` 和可选 subject，限制长度和字符集。
- [x] 对 revoked/unknown/malformed credential 使用统一 401，不泄露 credential 是否存在。

## Verification

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-app-credentials.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/ai-principal-scope.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api db:check
pnpm --filter @starter/api test
```

## Rollback

- adapter 可先只接入运行面新入口，Starter Cookie 兼容入口保留。
- credential migration 可回滚前提是未删除旧数据；禁止把 App secret 写入旧 Provider credential 表。
- 如果认证 header 尚未确定，先锁定内部 API 调用方式再实现 route，不能同时支持多个未定义 header。
