# AI runtime 与应用能力

## 目标

在现有 AI Provider 配置基础上，增加可复用的消息调用、会话、工具执行、调用审计和真实 Provider 验证能力，为后续聊天、Agent 和内容生成场景提供 API 基础。

## 背景

现有实现已经支持 Provider 配置、凭据加密、模型白名单、默认模型和单条 prompt 的 SSE 测试。当前 `AiGateway` 只接收 `model + prompt + signal`，只发送一条用户文本消息；没有会话消息表、工具执行循环和调用记录。

`@earendil-works/pi-ai` 只允许在 `apps/api/src/infra/ai/` 使用。跨层只使用项目自己的 contracts，不暴露 SDK 类型。API Key、OAuth token、Provider 原始错误和工具内部参数不进入响应、日志或调用审计；会话表只保存用户明确创建的项目消息 DTO。

## 范围

本父任务包含五个可独立验收的子任务：

- `08-15-ai-provider-smoke`：真实 Provider 冒烟验证。
- `08-15-ai-gateway-message-contract`：项目自己的多消息 Gateway 契约。
- `08-15-ai-conversation-foundation`：会话和上下文持久化。
- `08-15-ai-tool-execution-foundation`：工具定义、调用和执行循环。
- `08-15-ai-usage-audit`：用量和调用审计。

执行顺序：先完成 Gateway 契约，再依次实现会话、用量审计和工具循环；真实 Provider 冒烟在 Gateway 契约稳定后执行，最后做父任务级集成检查。

## 共同要求

- API 在调用前继续校验 Provider、模型启用状态、白名单和用户权限。
- contracts、API 业务模块、Admin 和数据库 schema 不导入 `@earendil-works/pi-ai` 类型。
- 所有模型消息、工具参数和模型响应在边界处使用项目自己的 schema 校验；完整工具参数和 model-facing result 只存在于当前 generation 的 API 内存上下文，持久化和公开 DTO 只保存文本与脱敏工具活动。
- prompt、response、API Key、OAuth token、环境变量值、文件路径和原始上游错误不得写入日志或调用审计表。
- 继续使用现有 SQLite、Drizzle、Hono、TanStack Query 和 Admin 权限模式。
- 不破坏现有 `POST /api/ai/test` 行为；需要新增接口时保留旧接口兼容。

## 验收条件

- [x] 五个子任务均有独立 PRD、技术设计、执行计划和对应测试。
  - gateway-message-contract、conversation-foundation、usage-audit、tool-execution-foundation、provider-smoke 五个子任务均含 prd/design/implement/research 与测试，`task.py validate` 全部通过。
- [x] Gateway 可以处理 system、user、assistant、tool result 等项目消息，并保持 Provider/model 复合 ID 校验。
  - `ai-gateway.test.ts` 覆盖消息映射、工具 schema、usage/cost、first-cause timeout/abort。
- [x] 会话消息可以创建、追加、读取、停止和继续生成，用户之间严格隔离。
  - `ai-conversations.smoke.test.ts` 覆盖 owner 隔离、多轮 Context、CAS、retry 复用、stop/timeout、恢复和上下文上限。
- [x] 工具调用经过 schema 校验、权限判断、超时、轮数限制和错误回填；不执行未经注册的工具。
  - `ai-tools.test.ts` 13 用例：空 registry 拒绝、超时/取消、轮数与单轮数量限制、未知/无权限工具不执行、错误回填。
- [x] `/api/ai/test` 和会话触发的每次真实 Provider 请求都能记录安全的 provider、model、用户、耗时、结果、token 和可用 cost 摘要；诊断用 Provider smoke 不写产品调用审计。
  - `ai-usage-audit.test.ts` 覆盖恢复、0/null 保持、幂等 finalize、写失败隔离；`ai-provider-smoke.test.ts` 断言临时库无 model call/tool execution 行。
- [x] 使用真实凭据时可以手动验证至少一个 API Key Provider；没有凭据时自动测试仍可运行且不会失败。
  - `ai:provider-smoke` 命令就绪并手动验证错误分类；本地无凭据，真实上游未执行（见 provider-smoke 任务记录），自动测试 197+95 全过。
- [x] 现有 AI 配置、模型测试、权限和敏感信息测试继续通过。
  - `ai.smoke.test.ts`、`ai-stores.test.ts`、`ai-auth.test.ts`、`authorization.smoke.test.ts` 均通过。
- [x] 类型检查、Lint、Format、API 测试、Admin 测试、构建和 migration 检查通过。
  - 见 implement.md 门禁记录。

## 不包含

- 图像输入和 `ImagesModels` 图像生成。
- Reasoning UI 和 Provider-specific options。
- 用户自带 API Key。
- 浏览器 OAuth 登录流程。
- 多 Provider 故障切换、负载均衡和多账号配置。
- 付费、充值、额度限制和自动计费。
- 任意模型手工录入。

## 已确认决定

- Tool calling 第一阶段只实现服务端注册、校验、权限、超时、取消和执行循环框架。
- 使用确定性测试工具完成自动验收，不注册用户资料、文件、网络、SQL、shell 等业务工具。
- 会话能力包含 Admin 登录后聊天页面、会话列表和历史消息，不只提供后端接口。
- 聊天入口使用 `/ai/chat`；Provider、模型偏好和用量审计继续放在设置分组。
