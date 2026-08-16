# AI Gateway 消息契约

## 目标

把当前单条 prompt Gateway 扩展为项目自己的多消息调用接口，使聊天、工具执行和调用审计可以共用同一套模型选择、超时、取消、事件和错误规则。

## 需求

- 在 `packages/contracts` 定义公开可序列化的会话消息、文本内容、脱敏工具活动、usage/cost 和 SSE 事件。
- 在 `apps/api/src/infra/ai/` 定义项目自己的内部 model message、工具定义、完整工具调用/结果、Gateway runtime 输入和事件；这些类型不包含 SDK 类型，也不向 Admin 直接返回。
- 第一阶段内容只支持文本；保留清晰的内容块判别结构，但不加入图片字段。
- Gateway runtime 输入支持 system prompt、多条 user/assistant/tool result 消息、可选工具、model ref、session ID、`turnIndex` 和内部取消信号；`AbortSignal` 不进入 contracts。
- Gateway 负责把项目 DTO 转换为 `pi-ai Context`，SDK 类型不得离开 `apps/api/src/infra/ai/`。
- Gateway 事件判别联合固定为：`text_delta`（事件级 `turnIndex/contentIndex/blockId`）、结构一致性已确认的 `tool_call_completed`（同样三字段）、`completed`（只有 `turnIndex`，其 `assistantMessage.blocks` 内每个 block 带三字段）。同一 block 的 delta 按到达顺序拼接；不同 block 的实时 delta 保留 SDK 到达顺序并用三字段归属，不能为排序而阻塞流。completed assistant message blocks 和 tool call 列表按 final assistant message 的 block 顺序输出。
- timeout、主动取消、认证失败和上游失败保持现有稳定错误码；`AiGatewayError` 额外携带 nullable 的安全 usage/cost、stop reason 和 error code，便于审计保存失败调用的部分 usage，不携带 SDK message 或原始错误。
- 不向业务层发送 thinking 内容、原始 SDK message、Provider payload、原始错误或 cost 明细对象。
- 保留现有单条 prompt 测试接口，可通过兼容适配调用新 Gateway。
- 显式模型无效时继续直接拒绝；未指定模型时继续使用用户默认和全局默认。

## 验收条件

- [x] completed event 只使用 `turnIndex`，assistant message block 带 `turnIndex/contentIndex/blockId`；text delta 保留 SDK 到达顺序，tool_call_completed 和 completed 按 final assistant message block 顺序映射，并有独立 schema 测试。
- [x] system、user、assistant、tool result 的转换有独立测试。
- [x] 工具参数离开 Gateway 时仍是 `unknown`；本任务只验证 `toolcall_end` 与 final assistant message 的结构一致性，项目 schema 校验由 `ai-tool-execution-foundation` 在进入 handler 前完成。
- [x] 认证、上游、timeout、abort 错误映射为现有 `AI.PROVIDER_AUTH_FAILED`、`AI.UPSTREAM_ERROR`、`AI.UPSTREAM_TIMEOUT`、`AI.REQUEST_ABORTED`，不把 infra kind 直接暴露给客户端。
- [x] 旧 `POST /api/ai/test` 的请求和 SSE 响应保持兼容。
- [x] `@earendil-works/pi-ai` 只出现在 `apps/api/src/infra/ai/`。

## 依赖

以已归档的 `ai-configuration-foundation` 为基础；本任务应先于会话、工具执行和真实 Provider smoke 完成。

## 不包含

- 图片内容块。
- Reasoning 参数或 thinking 文本展示。
- Provider-specific request options 和任意 header 输入。
- 会话数据库和 Admin 聊天页面。
