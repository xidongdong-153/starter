# 子任务技术设计

## 边界

`packages/contracts` 是三类自定义 Provider 协议的唯一 DTO 来源；`apps/api/src/modules/ai/ai.schema.ts` 保存 definition JSON 和审计字段；repository 负责 CAS、revision 和引用清理，不负责构造 `pi-ai` Provider。

## Contract 结构

- `kind`: `built_in | custom`。
- `protocol`: `openai-completions | openai-responses | anthropic-messages`。
- `baseUrl`: 已规范化 URL。
- `compat`: 按 protocol 的严格 union。
- `models`: 手工模型数组，包含能力和成本。
- credential 写入只在 command input 出现，response/provider DTO 只返回 mask/status。

## 存储规则

`ai_custom_providers.provider_id` 主键；`definition_json` 只存非 secret 定义；`revision` 从 1 开始。definition 更新和 credential 更新分别递增各自 revision。repository 的删除事务清理 enabled models、global default、catalog、provider config，Agent 引用检查由 service 在事务边界内完成。

## 检查

为 SQLite JSON、模型数量、协议 enum、revision 和 provider ID 增加约束；TypeScript/Zod 负责更细边界。migration 只新增自定义表和索引。
