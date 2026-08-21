# AI API 基座实施计划

本计划只适用于 API 基座父任务及其五个子任务。Admin 和 Web 任务不得绕过阶段 E 直接启动。

## 任务顺序

```text
A 08-21-ai-api-contract-surface
  -> B 08-21-ai-api-principal-scope
  -> C 08-21-ai-api-runtime-resource-scope
  -> D 08-21-ai-tool-package-contract
  -> E 08-21-ai-api-cross-product-verification
  -> 允许启动 Admin / Web 子任务
```

A 与部分 B 的设计可以并行讨论，但代码实施按 A -> B -> C -> D -> E 执行。每个子任务独立启动、独立检查、独立完成；父任务不直接改产品代码。

## 阶段 A：冻结公共协议与 API 面划分

任务目录：`.trellis/tasks/08-21-ai-api-contract-surface/`

### 文件边界

- 允许：`packages/contracts/src/ai.ts`、AI `*.openapi.ts`、`apps/api/src/openapi/api-docs.ts`、协议测试、API 规范文档。
- 暂不允许：认证 middleware、数据库 schema/migration、Session/Run owner 查询、Tool handler 行为。

### Checklist

- [x] 盘点所有 AI route 的 method/path/request/response/security。
- [x] 给 route 增加 `AI Control`、`AI Runtime`、`AI Compatibility` tag。
- [x] 明确 Admin DTO、Runtime DTO、Starter compatibility DTO 的命名和导出边界。
- [x] 补齐 HarnessEvent、Run snapshot、Transcript、SSE 恢复和错误说明。
- [x] 添加 contracts/OpenAPI 测试，确认不含 secret、Pi 类型、Admin view model。
- [x] 把当前事实写清：现有路径不搬迁；Cookie/ownerId 是兼容入口；Run live 是临时视图。

### Gate

只有接口表、事件事实表、OpenAPI tag 和专项测试通过，才能进入 B。

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-harness-contracts.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api build
pnpm --filter @starter/api db:check
```

## 阶段 B：PrincipalContext、ResourceScope 和 App Credential

任务目录：`.trellis/tasks/08-21-ai-api-principal-scope/`

### 文件边界

- 允许：AI auth/identity adapter、应用凭据 schema/repository/service/route、migration、审计、认证测试。
- 可以读取但不改：Better Auth、authorization middleware、Provider credential store。
- 暂不允许：Session/Run repository 的 scope 迁移，Tool 远程执行，删除 owner 字段。

### 固定协议

```http
Authorization: Bearer <app-secret>
X-AI-External-User-Id: <product-user-id>
X-AI-Subject-Type: <optional>
X-AI-Subject-Id: <optional>
```

`tenantId/projectId` 只能从 credential record 派生。App secret 不进入 Provider credential 表。

### Checklist

- [x] 定义 `PrincipalContext`、`ResourceScope` 和 adapter 接口。
- [x] Better Auth adapter 将现有 Cookie 请求转成 compatibility scope。
- [x] 新增 `ai_app_credentials` 表和 migration，保存 hash/prefix/scope/status/audit fields。
- [x] 实现 Admin create/list/rotate/revoke，secret 只返回一次。
- [x] 实现 Bearer middleware，统一处理 unknown/malformed/revoked credential。
- [x] 限制 externalUserId/subject 的 schema、长度和同时出现规则。
- [x] 记录 app credential 审计；审计不含 secret。
- [x] 保持现有 Cookie/Admin 请求兼容。

### Gate

- Credential secret marker 在响应、日志、DB、审计中不存在明文。
- credential scope 篡改测试失败且返回安全错误。
- revoke 后新请求失败。
- Better Auth 现有测试通过。

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-app-credentials.test.ts src/test/ai-principal-scope.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api db:check
pnpm --filter @starter/api test
```

## 阶段 C：Session/Run/Transcript/Agent/Usage Scope

任务目录：`.trellis/tasks/08-21-ai-api-runtime-resource-scope/`

### 文件边界

- 允许：AI Session/Run/Agent/Usage service、repository、presenter、schema/migration、recovery、跨 scope 测试。
- 必须保留：Pi Session DB 独立性、Starter owner compatibility adapter、Run Service 唯一状态写入口。
- 暂不允许：分布式队列、worker、跨节点 registry、产品数据库 join。

### Checklist

- [x] Session create/list/get/update/archive/transcript 接收 Principal/Scope。
- [x] Run start/get/abort/steer/follow-up 接收 Principal/Scope。
- [x] Run recovery 从持久 Session 重建 scope-safe identity，不只看 runId。
- [x] Agent/Prompt/Skill resolve 校验平台资源状态和 Agent revision；Tool 引用按运行 scope 校验。
- [x] 根据旧数据归属规则新增 Session scope columns；旧记录明确回填 Starter scope。
- [x] Model/tool audit 可以按 scope 过滤，敏感字段保持禁止。
- [x] 写不同 app/project/externalUserId 的隔离测试。
- [x] 保持双库 Session 补偿和 Run 终态顺序。

> 首版 Agent/Prompt/Skill 是 Starter 控制面平台资源，不伪造 tenant/project 归属；运行资源、Usage Audit 和 Tool execution 已按 Principal/ResourceScope 校验。

### Gate

- Starter Cookie 和 App Bearer 两条路径都通过已有及新增 Session/Run 测试。
- 越权统一 404，不泄露资源存在性。
- migration 有旧数据 fixture、索引检查和回滚说明。

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-agent-sessions.test.ts src/test/ai-agent-runs.test.ts src/test/run-live-snapshot.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/ai-harness-migration.test.ts src/test/ai-destructive-migration.test.ts --config vitest.config.ts
pnpm --filter @starter/api db:check
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
```

## 阶段 D：Tool Package Contract

任务目录：`.trellis/tasks/08-21-ai-tool-package-contract/`

### 文件边界

- 允许：`tool-registry.ts`、`pi-tool-adapter.ts`、runtime factory、tool contracts/summary、audit tests。
- 暂不允许：远程 endpoint、动态 import 用户输入、浏览器注册 handler、Tool handler 写业务数据库的临时旁路。

### Checklist

- [x] Tool name/version/description/schema/scope/permission/timeout contract 固定。
- [x] package 部署注册路径和 registry duplicate name/version 检查固定。
- [x] handler 接收 validated args、PrincipalContext、ResourceScope、requestId、signal、progress。
- [x] 保持完整 tool call 验证后再执行 handler。
- [x] 覆盖 invalid args/forbidden/failed/timeout/abort/progress/safe result。
- [x] 每个 audit begin 都 finalize；重复 finalize 不覆盖首个终态。
- [x] 检查 Tool summary、Agent snapshot、SSE、日志和 DB 的敏感字段。

### Gate

- Agent Run 测试和 Tool audit 测试通过。
- Tool contract 不依赖 Admin UI。
- 远程 Tool 只写 deferred 说明，不出现未定义网络协议。

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-test-tools.test.ts src/test/pi-agent-executor.test.ts src/test/ai-usage-audit.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
```

## 阶段 E：跨产品运行契约验证

任务目录：`.trellis/tasks/08-21-ai-api-cross-product-verification/`

### 文件边界

- 允许：非 Admin HTTP client fixture/helper、SSE chunk/断线测试、scope/secret matrix、接入说明。
- 不允许：import Admin 源码、复制 Admin reducer、为测试增加生产 fallback。

### Checklist

- [x] Product backend fixture 只使用公开 HTTP/OpenAPI/contracts。
- [x] Bearer credential + externalUserId + subject 完成 Session -> Run -> SSE -> terminal -> Transcript。
- [x] 任意 chunk、heartbeat、提前断流、Run 查询、Transcript 恢复通过。
- [x] 跨 scope、跨 externalUserId、revoked credential 和 malformed credential 通过。
- [x] busy、abort、provider failure、Tool error、Pi storage failure 行为由专项 Run/Tool 测试覆盖。
- [x] 敏感信息扫描覆盖响应、事件、日志和 DB。
- [x] 输出 Web 子任务可直接使用的运行调用说明。

### Gate

只有验证矩阵全部通过，API 父任务才完成。随后才允许启动 Admin/Web 子任务。

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-cross-product-runtime.test.ts --config vitest.config.ts
pnpm --filter @starter/api test
pnpm check-types
pnpm lint
pnpm format:check
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

## 总回滚规则

- 公共协议问题：回到 A，先改 contracts/OpenAPI/测试，再继续后续阶段。
- 认证问题：回到 B，保留 Cookie compatibility，不在 C 中绕过 adapter。
- 数据归属问题：回到 C，停止 migration，不使用默认 tenant/空 scope 继续运行。
- Tool 安全问题：回到 D，禁止通过测试 helper 加宽生产 registry。
- 跨产品失败：回到对应拥有该 contract 的阶段，不能在 E 的 client 中加私有兼容逻辑。

## 总验收命令

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```
