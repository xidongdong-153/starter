# Admin Harness 调试界面实施计划

## 前置条件

- S3、S5、S6 已完成并归档。
- Agent、Session、Run 和 SSE API 已通过 smoke tests。
- 旧 Conversation 页面仍存在。
- 启动前核对 S3/S5/S6 的 `task.json.status`、OpenAPI/RPC 类型、实际事件 schema 和测试结果；不按规划草稿手写客户端类型。

## 执行步骤

### 1. API 与 query

- [x] 增加 Session CRUD、transcript、Run 状态和控制请求函数。
- [x] 增加独立 query keys、queries 和 mutations。
- [x] 实现 HarnessEvent SSE parser 和取消 reader 的资源清理。
- [x] 按 `runId + sequence` 处理共享契约中的每个事件分支，以 `messageId` 和 `toolCallId` 更新临时视图。

### 2. Event reducer

- [x] 实现 sequence 去重、message buffer、Tool activity 和唯一终态。
- [x] 终态后失效 transcript、Session 和 Run query。
- [x] 断线只关闭 transport，不调用 abort。
- [x] 为纯 reducer 增加单元测试。

### 3. 页面

- [x] 新增 AgentSessions 页面、路由和导航。
- [x] 实现 Session 创建、选择、标题修改和归档。
- [x] 实现 Agent 选择、输入、启动和停止。
- [x] 显示 transcript、Tool 活动和终态错误。
- [x] 增加 loading、empty、busy、error 和 disconnected 状态。

### 4. i18n 与权限

- [x] 增加中英文 Agent Session、Run 和 Tool 状态文案。
- [x] 使用现有 AI route permission 和导航过滤。
- [x] 确认按钮和图标使用现有 lucide 组件与 tooltip 规则。

### 5. 测试

- [x] 覆盖创建 Session、启动 Run、增量消息、Tool 和 completed。
- [x] 覆盖 failed、aborted、interrupted、busy 和 401/403。
- [x] 覆盖显式停止调用 abort。
- [x] 覆盖卸载和断线不调用 abort、刷新后读取 transcript。
- [x] 同时运行旧 Conversation 页面测试。

### 6. 质量门

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
git diff --check
```

- [x] 启动 Admin 和 API，人工完成一次 Session/Run 流程。
- [x] 使用 `trellis-check` 复核页面状态、类型和共存边界。
- [x] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- SSE parser 与 contracts 不一致：停在 API 层，不在组件内兼容未知事件。
- 页面测试需修改旧 Conversation 产品代码才能通过：停止并重新检查边界。
- 回滚只删除新入口，不改后端或旧页面。
