# 跨层集成验证报告

## 结论

自定义 Provider 已通过 contracts、数据库、API runtime、Admin RPC、模型测试和 Agent Run 的跨层验证。三类协议均使用 fake upstream 完成模型测试 SSE 和 Agent Run native stream，Agent Run 在 `ai_model_calls` 写入 `scenario=agent_run` 的成功审计记录。

真实外部 Provider 未配置，本次协议验证使用本地 fake upstream；真实凭据、真实网络策略和第三方服务行为仍需在部署环境单独验收。

## 字段核对

| 边界 | 核对结果 |
| --- | --- |
| contracts -> API schema/OpenAPI | `providerId`、`protocol`、`baseUrl`、`compat`、`models`、`revision`、`enabled`、`authStatus` 和 `credentialMask` 使用共享 schema；secret 只在创建/凭据写入输入出现 |
| OpenAPI -> RPC | Admin RPC 从 `apps/admin/src/api/rpc.ts` 导出 custom-provider CRUD、check、credential、state 和 models 路径；请求/响应类型来自 API OpenAPI |
| RPC -> Admin query/page | `ai.api.ts` 和 `ai.query.ts` 使用 custom Provider contracts，mutation 后刷新 Provider、模型、用户模型和偏好查询 |
| definition -> database | `ai_custom_providers.definition_json` 保存无 secret definition；`revision` 用于 CAS；migration 0016 和 `db:check` 通过 |
| database -> runtime | runtime 启动读取并校验 definition，构造固定三协议 `pi-ai` Provider；热加载、卸载和重启恢复测试通过 |
| runtime -> Gateway/native stream | 同一 `providerId + modelId` 进入模型测试 Gateway 和 Agent Run native stream；三协议均写入对应 usage audit |
| delete -> references/cleanup | Agent 引用时返回 `AI.CUSTOM_PROVIDER_IN_USE`；解除引用后删除 definition、credential、catalog、白名单和默认模型引用 |

## 覆盖项

- `openai-completions`、`openai-responses`、`anthropic-messages`：真实 fake HTTP upstream 成功流。
- Provider 生命周期：create -> check -> enable -> allowlist -> default -> model test -> Agent Run -> disable -> delete。
- Agent 引用删除冲突：删除前返回稳定错误码；清除 Agent model 引用后删除成功。
- 普通用户权限：未启用 Provider/模型不出现在 `/api/ai/models`；Admin 管理接口对未授权用户返回 401/403。
- 错误分类：auth、timeout、abort、upstream、invalid model 使用项目稳定错误码；模型测试 SSE 终态符合 contracts schema。
- Secret 保护：响应、模型测试 SSE、Agent Run SSE、审计记录和数据库 definition 不包含 API key 或 prompt/response。
- URL 安全：危险 scheme、私网和 metadata 地址、redirect、response size、headers 后 body timeout、JSON 最大深度均有测试。
- 启动恢复：definition、credential 状态、模型目录和坏 definition 隔离恢复已有 runtime 测试。
- Admin：custom Provider 表单转换、query/mutation 缓存失效、权限和交互测试通过。

## 新增回归

- [ai-custom-provider-cross-layer.test.ts](/Users/wuwanzhu/Code/xdd/starter/apps/api/src/test/ai-custom-provider-cross-layer.test.ts)：按三种协议执行真实路由生命周期、模型测试、Agent Run、审计和删除清理。

## 验证命令

- `pnpm check-types`：通过。
- `pnpm lint`：通过。
- `pnpm format:check`：通过。
- `pnpm test`：通过；API 43 个测试文件/287 个测试，Admin 20 个测试文件/108 个测试，Web 2 个测试文件/12 个测试。
- `pnpm build`：通过。
- `pnpm --filter @starter/api db:check`：通过，Drizzle 报告 `Everything's fine`。
- `git diff --check`：通过。

## 残余风险

- 未连接真实 OpenAI、Anthropic 或其他第三方 Provider；真实凭据、上游限流、非标准响应和生产 DNS 解析需要部署环境验证。
- Admin 测试在 jsdom 下有既有 `getComputedStyle` 未实现提示，不影响测试结果。
- Turborepo 对测试任务提示未配置 output 文件，这是现有配置提示，不影响测试退出码。
