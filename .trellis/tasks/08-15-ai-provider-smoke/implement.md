# 真实 AI Provider smoke 执行计划

## 1. Runner

- [x] 增加独立 smoke env schema，不把选择变量和 prompt 放进通用 `AppEnv`。
  - `smokeEnvSchema`（`AI_SMOKE_PROVIDER_ID`/`AI_SMOKE_MODEL_ID`/`AI_SMOKE_PROMPT`/`AI_SMOKE_CHECK_AUTH`/`AI_SMOKE_REFRESH_MODELS`/`AI_SMOKE_TIMEOUT_MS`），与 `parseEnv` 分离。
- [x] 创建 `apps/api/src/scripts/ai-provider-smoke.ts`，支持依赖注入输出和 Gateway。
  - `runAiProviderSmoke(input, output, deps)`，`deps.aiGateway` 测试注入，`deps.signal` 支持取消；main 入口守卫同 `ai-auth.ts`。
- [x] 增加 `ai:provider-smoke` package script，不加入根 test/build/Turbo 默认任务。
  - `"ai:provider-smoke": "dotenv -e .env.development -- tsx src/scripts/ai-provider-smoke.ts"`。
- [x] 校验 provider/model、可选 auth check、可选 dynamic refresh 和调用 timeout。
  - provider 不在 registry、model 不在 catalog 时请求前失败；`AI_SMOKE_CHECK_AUTH` 只输出规范化 auth source/type；`AI_SMOKE_REFRESH_MODELS` 对不支持的 Provider 输出 `models_refresh=skipped`；timeout 默认取 `AI_REQUEST_TIMEOUT_MS`。
- [x] 只输出事件计数、provider/model、stop reason、usage、duration 和稳定错误分类。
  - `event=start`、`event=text_delta count=N`、`event=done stop_reason=… input_tokens=… output_tokens=… total_tokens=… duration_ms=…`、`event=error error=<分类>`、`result=success`。

## 2. 自动测试

- [x] fake Gateway 覆盖 success/auth/timeout/abort/upstream。
  - `ai-provider-smoke.test.ts` 五个用例：success、四个错误分类、provider/model 未找到、缺变量/无终态、未配置凭据 checkAuth。
- [x] faux Provider 覆盖正式 Gateway 文本、done、usage 和取消。
  - 由 `ai-gateway.test.ts`（既有）覆盖：faux Provider 文本/done/usage/cost、timeout、abort 和安全错误投影。
- [x] provider/model 未找到时 Gateway 不被调用。
  - `stream` 用 `vi.fn` 包裹断言 `not.toHaveBeenCalled()`。
- [x] stdout/stderr/logger 不含 secret、prompt 和 response marker。
  - 测试预置 prompt/response marker 并断言 log/error 输出不包含。
- [x] 断言 runner 不调用产品 audit coordinator，临时数据库不产生 model call/tool execution。
  - runner 只调用 `createRuntime`、`runtime.ai` 与 `runtime.aiGateway`；测试断言 `ai_model_calls`、`ai_tool_executions` 均为空。
- [x] 常规 `pnpm test` 和 `pnpm build` 不读取 smoke 变量、不访问网络。
  - 全量门禁通过（API 22 files/197 tests、lint、format:check、check-types 含 build）；smoke 变量仅在显式执行 runner 时读取。

## 3. 手工验证

无真实凭据，已手动执行验证命令行为和错误分类（见 prd.md 手工验证记录）。结论：runner 已验证，真实上游未执行。

## 4. 检查与回滚

运行 API 类型、Lint、Format 和测试。删除独立 package script 即可停用 smoke，不影响应用 runtime、API route 和默认 CI。

门禁记录（2026-08-15）：`pnpm --filter @starter/api test` 22 files/197 tests 通过；`pnpm lint`、`pnpm format:check`、`pnpm check-types`（含各包 build）、`git diff --check` 全部通过。
