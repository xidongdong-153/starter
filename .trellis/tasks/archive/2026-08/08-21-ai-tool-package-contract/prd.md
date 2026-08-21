# 固化 AI Tool Package Contract

## Goal

把产品业务 Tool 的注册元数据和执行 handler 约束成一个版本化 contract。第一阶段只支持 AI 平台部署时安装的可信 TypeScript package；未来增加远程 Tool 时复用同一 contract，不在本任务实现远程调用。

## Dependencies

- 前置：`08-21-ai-api-contract-surface`、`08-21-ai-api-principal-scope`。
- 与 runtime resource scope 部分并行，但最终必须在跨产品验证前完成。

## Tool Contract

```ts
interface RegisteredAiToolDefinition {
  name: string
  version: string
  description: string
  inputSchema: ZodType
  timeoutMs: number
  scope: { tenantId: string; projectId: string } | 'platform'
  requiredPermission: string | null
  execute: (input: {
    args: unknown
    principal: PrincipalContext
    scope: ResourceScope
    requestId: string
    signal: AbortSignal
    reportProgress: (safeSummary: string) => void
  }) => Promise<{
    modelText: string
    safeSummary: string | null
  }>
}
```

实际导出类型可按现有 `RegisteredAiTool/defineAiTool` 调整，但不能降低这些边界：

- name + version 唯一；Agent allowlist 必须引用明确版本或可验证版本策略。
- schema 在进入 handler 前 parse；模型输出只拿受限 modelText。
- handler 只接收已解析 args、PrincipalContext、ResourceScope、requestId、AbortSignal 和进度函数。
- timeout 100-30000ms；progress/safeSummary 最多 1000 字符；arguments/modelText 受现有限制。
- 平台执行 allowlist、scope、权限、timeout、取消、audit begin/finalize 和错误分类。
- handler 异常不能把原始错误、arguments、result 或 secret 写入日志/DB/SSE。
- 每个已 begin 的 audit 必须 finalize；重复 finalize 不覆盖第一终态。
- 未注册、参数无效、无权限、handler failed、timeout 分别映射稳定错误码和安全 model result。

## Package Registration

- TypeScript package 由 API 部署时安装，启动时通过 `RuntimeDeps.aiTools` 或明确 runtime factory 注册。
- 生产默认 registry 只包含允许的 platform tools；测试可注入 fake registry。
- package 不能直接拿 DB client、Better Auth session、环境变量 secret 或修改 Run/Session 主库；需要业务数据时由后续受控接口提供。
- Admin Tool list 只返回 name/description/version 等公开元数据，不返回 Zod schema 或 handler。
- 远程 Tool 的签名、endpoint、重试、幂等、版本协商和网络故障只记录后续设计，不实现。

## Acceptance Criteria

- [ ] Tool contract 定义名称、版本、描述、schema、scope、权限、timeout、取消、审计和安全输出。
- [ ] `AiToolRegistry` 能拒绝重复 name/version、未授权 scope 和不合法 timeout。
- [ ] Agent Definition 只能引用 registry 中可用 Tool，Tool 变化不会修改已启动 Run snapshot。
- [ ] Tool handler 收不到原始请求身份、未解析 args 或任意 runtime 内部对象。
- [ ] Tool audit 在成功、失败、invalid args、forbidden、timeout、abort 下都能 finalize。
- [ ] Admin/API/SSE/日志/数据库均不出现 arguments、result、secret 和原始异常。
- [ ] 现有工具测试、Agent Run 测试和类型/Lint/Format 通过。

## Evidence

- `apps/api/src/modules/ai/tool/tool-registry.ts`
- `apps/api/src/infra/agent/pi-tool-adapter.ts`
- `apps/api/src/infra/ai/ai-tool-schema.ts`
- `apps/api/src/modules/ai/usage-audit/usage-audit.service.ts`
- `apps/api/src/bootstrap/create-runtime.ts`
- `apps/api/src/test/ai-test-tools.test.ts`
- `apps/api/src/test/pi-agent-executor.test.ts`
- `.trellis/spec/api/backend/ai-integration-guidelines.md`
