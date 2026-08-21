# AI Tool Contract 实施计划

## 阶段 1：contract 和 registry

- [x] 检查现有 `RegisteredAiTool`、`defineAiTool`、`AiToolRegistry`，补 version/scope/公开 summary 字段。
- [x] 统一 timeout、schema、description、requiredPermission 和 safe output 限制。
- [x] 给重复 name/version、不可用 scope 和 invalid version/timeout 增加测试。

## 阶段 2：adapter 和 executor

- [x] Pi adapter 把已校验 args、PrincipalContext、ResourceScope、requestId、signal 传给 handler。
- [x] 保持 tool_call 验证顺序：缓存完整调用 -> 等成功 done/final message -> allowlist/schema/permission -> 执行。
- [x] 保持 tool progress 只发送 safeSummary，不进入 modelText 或审计原文。

## 阶段 3：audit 和敏感信息

- [x] 覆盖 begin/finalize 成功、失败、超时、abort、审计写失败隔离和重复 finalize。
- [x] 检查日志、SSE、transcript、main DB 不出现 secret/arguments/result。
- [x] Agent snapshot 和 Admin tool summary 不出现 handler/schema 内部对象。

## Verification

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-test-tools.test.ts src/test/pi-agent-executor.test.ts src/test/ai-usage-audit.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
```

## Deferred

远程 Tool 的 endpoint、签名、网络重试、幂等、版本协商和服务发现必须等至少两个真实产品需要独立部署后再建任务。
