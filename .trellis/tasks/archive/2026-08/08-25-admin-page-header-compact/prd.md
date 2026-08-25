# admin 页面头部重构：压缩页头、统一工具栏

## Goal

Admin 每个页面顶部的 `AdminPageHeader` 大卡片（边框 + 背景 + 大 padding）占用过多垂直空间，挤压下方表格和表单内容。改为无卡片的单行页头 + 表格上方统一工具栏，让内容区获得更多空间。

## 用户确认的设计决策

- **页头（方案 A）**：去掉卡片视觉（边框、背景、圆角、阴影），压缩为单行。左侧标题，描述并入标题行（text-sm 小字，过长截断），有返回按钮时返回按钮放标题前。
- **工具栏（方案 A2）**：操作按钮和筛选控件合并为一条工具栏，放在表格上方。左侧放筛选和摘要标签，右侧放操作按钮。
- **摘要标签**：移入工具栏左侧，与筛选控件同行，信息不丢。
- **描述文字**：并入标题行，标题后面跟一行小字描述。

## 已确认的事实

- `AdminPageHeader` 定义在 `apps/admin/src/components/common/AdminPageHeader.tsx`，由 `components/common/index.ts` 统一导出。
- 17 个页面使用它：`features/home/pages/Home.tsx`、`features/system/pages/LogViewer.tsx`、`features/ai/pages/{AiSettings,AiUsageAudit,Agents,SystemPrompts,AiApplications,PromptTemplates,Skills,AiProviders}.tsx`、`features/examples/pages/{EnvExample,UiShowcase}.tsx`、`features/users/pages/UserManagement.tsx`、`features/files/pages/FileList.tsx`、`features/account/pages/ProfileSettings.tsx`、`features/authorization/pages/{AuthorizationAudit,AuthorizationSettings}.tsx`。
- 各页面现有布局：`AdminPageHeader`（含 actions）→ 错误 Alert → 独立筛选行（仅 UserManagement、FileList）→ Table / 表单。
- UserManagement 的摘要标签（总数）与 Table 分页的 `showTotal` 重复，迁移时去掉摘要标签。
- 测试文件不直接引用 `AdminPageHeader`，断言基于文案和按钮，布局调整不破坏断言。

## Requirements

- 页头去掉卡片视觉，压缩为单行；垂直占位显著小于现状。
- 操作按钮与筛选控件统一进表格上方的工具栏，交互集中一处。
- 17 个页面行为不丢失：创建、上传、刷新、筛选、清除、摘要信息全部保留可达。
- 无筛选、无操作按钮、无摘要标签的页面（如 AiSettings）不出现空工具栏。
- 响应式：窄屏下页头与工具栏可换行，不溢出、不错乱。
- 视觉风格与现有 theme 变量和 Tailwind 惯例一致。
- 数据流、路由、i18n 键、API 调用全部不变。

## Acceptance Criteria

- [ ] 17 个页面全部使用新版紧凑页头，无页面残留旧大卡片。
- [ ] 每个页面的原有操作按钮（新建/上传/刷新等）在工具栏中可见可用。
- [ ] 每个页面的原有筛选控件（搜索、下拉筛选、清除）在工具栏中可见可用。
- [ ] 页面垂直空间：页头 + 工具栏合计高度明显低于旧卡片页头。
- [ ] `pnpm --filter @starter/admin check` 通过（类型 + Lint + Format）。
- [ ] `pnpm --filter @starter/admin test` 通过。
- [ ] 本地启动 Admin（端口 2333）抽查至少 5 个页面（覆盖：带操作按钮、带筛选、带摘要标签、无工具栏四类）。

## Out of Scope

- 不调整顶部 AppHeader、侧边栏、TabBar 等全局布局组件。
- 不改各页面表格/表单内部结构。
- 不删除任何现有功能。
- 不改 API、contracts、web 端。
