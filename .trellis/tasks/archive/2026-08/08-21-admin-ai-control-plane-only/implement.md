# Admin AI 控制面执行计划

分两段做：先删运行面消费代码，再补应用凭据管理页。两段之间跑一次类型检查，避免把删除产生的报错和新页面的报错混在一起。

## 阶段一：删除 Agent Sessions 与 Harness 消费代码

- [x] `features/ai/routes.tsx` 移除 `ai.agentSessions` 路由记录。
- [x] 删除 `features/ai/pages/AgentSessions.tsx`、`features/ai/harness/`、`features/ai/components/timeline/`、`features/ai/components/MarkdownRenderer.tsx`、`features/ai/components/CodeBlock.tsx`。
- [x] 删除 `api/ai/harness.api.ts`、`api/ai/harness.query.ts`，并清掉 `api/ai/index.ts` 中的对应导出。
- [x] 删除 `test/agent-sessions.test.tsx`、`test/harness-stream-reducer.test.ts`、`test/harness-timeline.test.ts`。
- [x] `test/navigation.test.ts`、`test/ai-api.test.ts`、`test/ai-query.test.tsx` 去掉指向 Agent Sessions 和 harness 的断言。
- [x] `i18n/locales/zh.ts`、`en.ts` 删除 `menu.aiAgentSessions` 和只服务该页面的文案分支。
- [x] 删完再全仓搜索 `AgentSessions`、`harness`、`agent-sessions`，确认只剩 API 侧和 contracts 里的运行协议。

阶段一验证：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin test
```

## 阶段二：新增应用凭据管理页

- [x] `api/ai/application.api.ts`：list、create、rotate、revoke 四个函数，走 `apiRpc.api.ai.admin.applications` + `unwrapApiData`。
- [x] `api/ai/ai.query.ts` 增加 `aiQueryKeys.applications()`。
- [x] `api/ai/application.query.ts`：`useAiApplicationsQuery` 和三个 mutation，成功后 invalidate 应用列表；带 secret 的响应只返回给调用方，不写缓存。
- [x] `api/ai/index.ts` 导出新增 API 与 hook。
- [x] `features/ai/pages/AiApplications.tsx`：表格列 name、tenantId、projectId、status、secretPrefix、createdAt、lastUsedAt、操作；创建用 Modal 表单，轮换和撤销用 Popconfirm；写操作包 `PermissionGuard`。
- [x] secret 一次性弹窗：独立 Modal，展示完整 secret + 复制按钮，文案写明关闭后不可再查看，关闭时清空 state。
- [x] `features/ai/routes.tsx` 增加 `/ai/applications` 路由，`permission: PermissionKeys.AI_CONFIG_MANAGE`，菜单进 ai 组。
- [x] `i18n/locales/zh.ts`、`en.ts` 补 `menu.aiApplications` 和 `ai.applications.*` 文案。
- [x] 新增 `test/ai-applications.test.tsx`：覆盖列表渲染、创建后展示一次性 secret、撤销行禁用轮换、加载与失败状态。

## 最终验证

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test
pnpm --filter @starter/admin build
```

## 回滚点

- 阶段一删完发现某个管理页面依赖被删文件：恢复该文件，改回引用，不在管理页里重新引入 harness 消费逻辑。
- 阶段二 RPC 类型对不上（`apiRpc.api.ai.admin.applications` 不存在）：停下来检查 API 是否导出了该路由类型，不用手写 fetch 绕过 RPC。
- 不删除 `packages/contracts/src/ai.ts` 里的 HarnessEvent 和运行 schema。

## 检查后的收尾改动

trellis-check 报出的问题，本次一起处理：

- `AiApplications.tsx`：`tenantId`/`projectId` 用 `aiScopeIdSchema.safeParse` 做 validator，`name` 加 `whitespace: true` 并在提交前 trim；`submitCreate` 自己 catch `validateFields` 的 rejection，避免 Modal onOk 产生 unhandled rejection。
- 一次性 secret 弹窗关闭时调用 `createApplication.reset()` / `rotateSecret.reset()`，把值从 MutationCache 清掉；弹窗标明是哪个应用的 secret。
- `test/ai-query.test.tsx` 补应用 query key 与 mutation 失效用例，`test/ai-applications.test.tsx` 补 scope 格式校验用例。
- `apps/api/src/test/run-live-snapshot.test.ts` 的注释去掉已删除的 Admin 测试引用。
- 文案：`ai.promptTemplates.pageDescription` 不再提 Admin 对话页；`secret.copyFailed` 去掉客服腔。
- spec 同步：`.trellis/spec/api/backend/ai-system-design.md`、`agent-run-guidelines.md` 把运行面消费者改成产品前端；`.trellis/spec/admin/frontend/component-guidelines.md`、`quality-guidelines.md` 删掉会话时间线规则，补一次性凭据展示、schema validator 和 Modal onOk 校验的写法。
