# 真实 AI Provider 冒烟验证

## 目标

提供显式执行的真实上游验证命令，证明现有凭据解析、模型选择、Gateway 流式事件、超时和取消可以与真实 Provider 一起工作，同时不让本地 secret 进入仓库或常规 CI。

## 需求

- 增加独立 smoke 命令，不混入默认 `pnpm test`。
- 通过环境变量指定 Provider ID、model ID 和短 prompt，不在命令行参数中传 API Key。
- 复用正式 `AiRuntime`、CredentialStore 和 Gateway，不另写一套 Provider 调用代码。
- 至少支持普通 API Key Provider 的文本流验证。
- OAuth 和动态目录 Provider 使用同一 runner；缺少对应凭据时明确跳过或返回配置说明。
- 输出只包含 Provider/model、事件类型、stop reason、token、耗时和规范化错误码，不输出 prompt、response、secret 或原始上游错误。
- 自动测试使用 faux Provider 验证 runner 的成功、认证失败、超时、取消和错误脱敏。

## 验收条件

- [x] 配置真实凭据后，一条命令可以完成真实文本流调用并返回成功状态。
  - 验证：`pnpm --filter @starter/api ai:provider-smoke` 已实现并通过注入 fake Gateway 的自动化测试（success 用例 exit 0、输出 `result=success`）。本地无真实 Provider 凭据，真实上游未执行；手动运行时无凭据稳定返回 `error=auth_failed` 且 exit 1。
- [x] 未配置 smoke 环境变量时，常规测试和构建不失败。
  - 验证：API 22 files/197 tests、`pnpm lint`、`pnpm format:check`、`pnpm check-types`（含 build）全部通过；smoke 变量使用独立 `smokeEnvSchema`，不进通用 `AppEnv`。
- [x] Provider 或 model 不在 registry/catalog 时在请求前失败。
  - 验证：`ai-provider-smoke.test.ts` 断言 exit 1 且 Gateway 的 stream 未被调用；手动运行 `AI_SMOKE_PROVIDER_ID=not-a-provider` 输出「Provider 不在 registry 中」并 exit 1。
- [x] 上游认证失败、超时和取消返回稳定分类。
  - 验证：`auth→auth_failed`、`timeout→upstream_timeout`、`aborted→aborted`、`upstream→upstream_failed`，测试逐个断言。
- [x] 测试输出和日志中查不到预置 secret、prompt 和 response。
  - 验证：测试预置 `SMOKE_PROMPT_MARKER_9f2c`、`SMOKE_RESPONSE_MARKER_4a1d`，断言 log/error 输出均不包含。
- [x] runner 调用正式 Gateway，不直接调用 SDK stream API。
  - 验证：runner 通过 `runtime.aiGateway.stream(gatewayInput)` 调用，测试注入 fake Gateway 替换；runner 不导入 Provider SDK。

## 手工验证记录

无真实 Provider 凭据（`.env.development` 仅有加密密钥、超时和 GitHub OAuth 配置），手动执行仅验证命令行为和错误分类：

- `AI_SMOKE_PROVIDER_ID=openai AI_SMOKE_MODEL_ID=gpt-4o-mini AI_SMOKE_PROMPT=hello-smoke` → exit 1，输出 `provider=openai model=gpt-4o-mini event=start` 与 `event=error error=auth_failed`，未输出 prompt。
- `AI_SMOKE_PROVIDER_ID=not-a-provider` → exit 1，输出「Provider 不在 registry 中」。
- 结论：runner 已验证，真实上游未执行。有凭据后运行

  ```bash
  AI_SMOKE_PROVIDER_ID=<provider> \
  AI_SMOKE_MODEL_ID=<model> \
  AI_SMOKE_PROMPT=<short-prompt> \
  pnpm --filter @starter/api ai:provider-smoke
  ```

  真实变量值不写入任务文档、日志或最终报告。

## 依赖

依赖 `08-15-ai-gateway-message-contract` 稳定正式调用输入和事件契约。

## 不包含

- 在公共 CI 中保存真实 Provider secret。
- 对 40 个 Provider 逐个执行付费请求。
- 性能压测、并发压测或 SLA 基准。
