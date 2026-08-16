# AI 用量与调用审计

## 目标

为每次 AI 模型调用和工具执行保存安全、可查询的元数据，使管理员能够定位失败、查看 token 与成本趋势，同时不保存 prompt、response 或凭据。

## 需求

- 增加 AI 调用记录表，至少保存 request ID、用户、场景、会话、Provider、model、开始/结束时间、耗时、结果、stop reason、稳定错误码和 token usage。
- SDK 提供 cost 时保存规范化数值和币种语义；缺失时保持 null，不自行估算价格。
- 工具执行记录关联模型调用，保存工具名称、状态、耗时和安全错误分类，不保存完整参数与结果。
- 调用记录由服务端统一创建和结束；成功、上游失败、超时、取消都必须有终态。Provider 返回 `tool_use` 的 model call 以 `succeeded` 结束，工具失败由 tool execution 和 generation 记录。
- 数据库写审计失败不能改变已经完成的模型响应，但必须写服务端结构化错误日志。
- 增加独立管理员读取权限、分页和筛选接口；支持用户、Provider、model、结果、request ID 和时间范围筛选。
- Admin 增加用量与调用审计页面，使用表格和详情 Drawer 展示元数据、token、cost、耗时、错误码和工具摘要。
- 查询 DTO 使用字段白名单，不返回 prompt、response、credential、原始错误或内部工具参数。

## 验收条件

- [ ] 文本成功、认证失败、上游失败、超时、取消和工具失败均可查询：前五类产生 model call 终态，工具失败额外产生 tool execution 和 generation 终态，不把工具失败改写成已完成的 Provider 请求。
- [ ] 有 usage/cost 时完整保存，无数据时使用 null，不生成虚假数值。
- [ ] 管理员可以分页和筛选记录；无权限用户 API 返回 403 且看不到导航。
- [ ] Admin 覆盖 loading、空数据、错误重试、筛选、分页和详情状态。
- [ ] 测试使用预置 secret、prompt、response 和工具参数扫描审计表、审计 API 与相关日志，均无匹配；会话表只保存文本和脱敏 tool activity。
- [ ] 审计写入失败不会把成功模型调用转换为客户端失败。

## 依赖

依赖 `08-15-ai-gateway-message-contract` 的统一开始、完成、错误和 usage 事件，也依赖 `08-15-ai-conversation-foundation` 先创建 conversation/generation 表；工具任务消费本任务提供的 tool execution coordinator。

## 不包含

- 用户额度、余额、充值和账单。
- 自动成本告警和预算限制。
- 数据仓库、图表大盘和外部 telemetry 导出。
- prompt 与 response 内容审计。
