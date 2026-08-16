# AI Tool calling 与执行循环

## 目标

实现服务端工具注册、参数验证、权限检查和多轮执行循环，使模型只能调用项目明确注册且当前用户有权使用的工具。

## 需求

- 增加项目自己的工具定义和注册表，业务模块不依赖 `pi-ai Tool` 类型。
- 每个工具声明稳定名称、描述、输入 schema、执行超时、所需权限和可记录的安全摘要。
- 模型返回 tool call 后，先按名称查注册表，再使用 schema 校验参数；未知或非法调用只返回结构化 tool error，不执行代码。
- 工具执行接收当前用户、request ID、abort signal 和经过校验的参数。
- 单次模型请求限制工具调用轮数、每轮调用数量和总执行时间。
- 工具成功或失败都转换为项目 tool result 消息，再继续调用模型直到完成或达到限制。
- 客户端可看到 `AiToolActivityEvent` 的工具名称、执行状态和 handler 显式提供的安全摘要；持久化 `AiToolActivity` 不含摘要，两种 schema 分开定义。
- 当前 generation 的内部 Context 可以临时包含完整 tool call/result；工具 arguments JSON 和 model-facing result 各自最多 16000 字符，每次 Provider 请求前还必须通过 50 条消息/100000 字符总预算。
- 数据库和公开会话 DTO 只保存 tool call ID、工具名、状态和稳定错误码。safeSummary 只在当前 SSE 返回，不写数据库。
- 自动测试使用确定性的测试工具覆盖成功、参数错误、未知工具、权限拒绝、超时、取消、动态上下文限制和轮数上限。

- 第一阶段不注册生产业务工具；测试工具只存在于测试注入或明确的测试运行时中，不能出现在生产 registry。

## 验收条件

- [x] `toolcall_end` 后只有收到成功 completed/tool_use 才能执行；error、deferred 或 aborted 时 handler 和 tool audit 均不启动。
- [x] 合法工具调用能执行并把结果回填给模型，最终返回文本回答。
- [x] 未注册工具、schema 无效参数和无权限调用不会执行 handler，但在 modelCallId 可用时分别产生 `not_found`、`invalid_arguments`、`forbidden` tool execution 终态。
- [x] 工具超时、取消和达到轮数/数量/总时限上限会停止循环并返回稳定错误；所有已 begin tool execution 离开 running。
- [x] 并行 tool call 的执行策略明确且测试可重复。
- [x] 日志、响应和审计记录不包含标记为敏感的工具参数或完整结果。
- [x] 会话历史只持久化脱敏 tool activity 项目 DTO，不保存完整 arguments 和 model-facing result。

## 依赖

依赖 `08-15-ai-gateway-message-contract`。与 `08-15-ai-conversation-foundation` 集成持久化工具消息，与 `08-15-ai-usage-audit` 集成调用记录。

## 不包含

- 管理员在页面动态编写 JavaScript 或上传工具。
- 任意 shell、SQL、文件系统和公网请求执行器。
- MCP server 管理和第三方插件市场。
- 用户资料、文件、网络、SQL、shell 等生产业务工具。
