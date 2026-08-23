# 子任务技术设计

## Runtime

`createAiRuntime` 创建 `MutableModels`，先 set 内置 Provider，再从 definition repository 构造 custom Provider。custom Provider 只使用固定代码映射：

- `openai-completions` -> `openAICompletionsApi()`。
- `openai-responses` -> `openAIResponsesApi()`。
- `anthropic-messages` -> `anthropicMessagesApi()`。

数据库不提供模块路径、脚本或任意 API implementation。

## 生命周期

启动加载 definition，坏记录隔离；创建/更新执行 definition/config 事务后 reload；删除必须通过引用检查和清理事务后调用 `models.deleteProvider`。既有 Gateway、Pi native stream、audit 只接收统一 `Model<Api>`。

## 控制面

统一读取 Provider 列表增加 `kind` 和 custom 摘要；custom 写接口独立于 built-in config 接口。check 记录 config revision，enable 只接受 ready 且 checked revision 一致。model replace 只接受当前 definition 的模型 ID。

## 网络安全

保存时和实际请求前都运行 URL guard；检查 scheme、解析 IP、重定向和响应限制。默认 production 拒绝 loopback/private/link-local/metadata，development 允许 localhost。请求错误只映射项目错误码。
