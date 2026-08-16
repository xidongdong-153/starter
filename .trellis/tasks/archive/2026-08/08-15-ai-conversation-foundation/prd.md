# AI 会话基础

## 目标

为登录用户提供可持久化的 AI 会话和消息，使用户能够创建会话、发送消息、查看历史、停止生成，并在已有上下文上继续生成。

## 需求

- 增加会话、消息和 generation 表，资源查询始终带当前用户条件；一次 generation 表示一次用户发送，可关联多轮模型调用和工具执行。
- 会话保存标题、所有者、创建/更新时间、当前或最近使用的模型和状态。
- 消息保存公开项目 DTO 所需的文本、角色、顺序、调用状态、模型引用、脱敏工具活动和时间；不保存 SDK 私有对象、完整工具参数或 model-facing result。
- 用户可以创建、列出、查看和删除自己的会话，不能读取其他用户会话。
- 发送消息时服务端读取持久历史，调用新 Gateway，并通过 SSE 返回增量事件。
- 中止生成后保留已经收到的部分 assistant 文本，消息状态为 `aborted`；下一次请求将该条部分 assistant 消息按项目 DTO 继续放入 Context，不把它当作新的 user 消息。
- 会话中允许显式选择当前白名单模型；模型失效时已有历史仍可读取，但新调用必须选择有效模型。
- Admin 增加 `/ai/chat` 聊天页面，包含会话列表、消息区、模型选择、发送、停止、错误重试、空状态和移动端布局。
- 错误重试只允许针对会话最新一个 `failed` 或 `aborted` generation：复用该 generation 的原 user 消息，不重复插入 user 消息；创建新的 assistant 占位和 generation，并记录 `retryOfGenerationId`。重试 Context 排除原失败/中止 assistant；普通后续发送仍包含已保存的 aborted partial assistant。
- 第一阶段使用最多 50 条消息和 100000 个文本字符保护上下文；超限时返回明确错误，不自动摘要或截断。

## 验收条件

- [x] 用户可以创建会话，发送消息并刷新页面后继续查看历史。
- [x] 连续两轮请求会把前一轮 assistant 消息作为上下文发送给模型。
- [x] 用户 A 无法读取、修改或删除用户 B 的会话。
- [x] 停止生成后部分回答可见且状态明确，下一次发送不会被旧流覆盖。
- [x] retry 不重复创建 user 消息，只新增 generation 和 assistant 消息；成功 generation 或非最新 generation 不可重试。
- [x] Provider 停用或模型移出白名单后，历史可读，新调用按当前规则拒绝。
- [x] 会话和消息的 loading、空数据、错误、pending、abort 和重试状态有测试。
- [x] 桌面和 390px 移动视口无页面级横向溢出。

## 依赖

依赖 `08-15-ai-gateway-message-contract`。工具消息结构由 Gateway 契约定义，实际工具执行由 `08-15-ai-tool-execution-foundation` 提供。

## 不包含

- 图片附件。
- 工具执行的完整 arguments 和 model-facing result 持久化；会话只保存脱敏工具活动。
- 自动标题生成和对话摘要。
- 会话分享、协作和公开链接。
- 只提供 API 而没有用户聊天页面的交付方式。
- 搜索、文件夹、置顶和批量删除。
- 无限上下文和自动压缩。
