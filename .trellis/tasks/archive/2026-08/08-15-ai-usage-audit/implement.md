# AI 用量与调用审计执行计划

## 1. Schema 与权限

- [ ] 增加 `ai_model_calls`、`ai_tool_executions` schema、索引和 migration。
- [ ] 增加 `AI_USAGE_READ` permission 并在 migration 注册。
- [ ] 增加 call/tool status、timeoutMs、usage/cost、列表/详情/query contracts 和 OpenAPI schema。

## 2. 写入路径

- [ ] 创建 audit repository 和 coordinator 的 begin/finalizeOnce；返回可传给工具执行的 nullable modelCallId。
- [ ] 在 `/api/ai/test` 和会话 Gateway 调用边界统一接入 runner，覆盖成功、认证失败、上游失败、超时和取消；调用前的 session/输入/模型校验失败不创建记录，`tool_use` 记录为 succeeded。
- [ ] 提供 tool execution begin/finalize coordinator；实际 handler 接入在 `ai-tool-execution-foundation` 完成。
- [ ] 实现审计写失败不影响主响应的安全日志。
- [ ] 启动时恢复过期 running 记录。

## 3. 读取与 Admin

- [ ] 实现 calls 列表、详情、稳定分页和全部精确筛选。
- [ ] route 使用 `requireAuth + AI_USAGE_READ`。
- [ ] 增加 Admin API/query、`/settings/ai/usage` 路由、导航、i18n、表格和详情 Drawer。
- [ ] Query key 包含完整分页和筛选对象。

## 4. 测试

- [ ] 终态矩阵、0/null usage/cost、幂等 finalize，以及 model call/tool execution 的 interrupted 恢复。
- [ ] 401、403、独立权限和 admin 默认权限。
- [ ] 稳定分页、筛选和 presenter 字段白名单。
- [ ] model call 使用 `min(AI_REQUEST_TIMEOUT_MS, generationRemainingMs)`；tool call 按名称先取 timeout 元数据，未知名称为 5000ms，已注册工具为 `min(tool.timeoutMs, generationRemainingMs)`。
- [ ] model call/tool execution 存储 effective timeoutMs；测试刚创建 running 不恢复，超过 `startedAt + timeoutMs + 5000` 的记录恢复为 interrupted。
- [ ] finalize 失败且已观察到 Provider/tool 终态时保持 running；未观察到终态时才写 interrupted，最终结果和 finalize 调用次数有断言。
- [ ] 审计表、审计 API 和相关日志不含 secret、prompt、response、raw error、tool arguments/result；会话表只保存文本和脱敏 tool activity。
- [ ] Admin loading、empty、error、筛选、分页、Drawer 和移动布局。

## 5. 检查与回滚

运行全仓检查、构建和 `db:check`。审计 coordinator 可在装配层关闭而不影响 Gateway；新增表保留，旧 AI 接口继续工作。
