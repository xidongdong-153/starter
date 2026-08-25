# 应用凭据创建时自动生成 scope id

## Goal

新建应用凭据时，tenantId 和 projectId 自动生成随机值，用户不用手填；需要自定义时展开高级设置修改。

## Requirements

- 修改 `apps/admin/src/features/ai/pages/AiApplications.tsx` 的新建弹窗表单。
- 打开新建弹窗即生成 tenantId 和 projectId 的随机值并填入表单。
  - 格式：`ten_` + 32 位 hex（tenantId）、`prj_` + 32 位 hex（projectId），用 `crypto.randomUUID().replaceAll('-', '')` 生成。
  - 生成值满足 `packages/contracts/src/ai.ts` 中 `aiScopeIdSchema` 的 `^\w[\w.:-]*$` 和 1-120 长度约束。
- tenantId 和 projectId 两个字段收进折叠的"高级设置"区，默认收起；展开后可修改。
  - 用 antd `Collapse` ghost 模式实现。
- 每次打开弹窗都重新生成，不沿用上次的值。
- 提交逻辑和字段校验不变；scope 校验失败时错误提示仍按 antd 规则显示。
- i18n：`apps/admin/src/i18n/locales/zh.ts` 和 `en.ts` 的应用凭据段新增"高级设置"文案。
- 测试 `apps/admin/src/test/ai-applications.test.tsx` 同步更新。

## Acceptance Criteria

- [ ] 打开新建弹窗只显示名称字段和折叠的高级设置，tenantId / projectId 默认隐藏
- [ ] 直接填名称提交，mutateAsync 收到自动生成的 tenantId / projectId，格式满足 `^\w[\w.:-]*$`
- [ ] 展开高级设置可看到已生成的值，可修改，提交后使用修改值
- [ ] scope 校验失败的错误提示仍显示
- [ ] `pnpm --filter @starter/admin test` 通过
- [ ] `pnpm --filter @starter/admin check` 通过（type-check + lint + format:check）

## Notes

- 生成在前端本地完成，不新增后端接口。
- 每个新建弹窗重新生成，保证每次创建默认拿到新 scope。
- 轻量任务，PRD-only。
