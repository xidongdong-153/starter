# implement — admin 页面头部重构

## 实施顺序

1. **重写 `AdminPageHeader`**（`apps/admin/src/components/common/AdminPageHeader.tsx`）
   - props 收敛为 `title / description? / onBack? / backLabel?`
   - 无卡片单行渲染，描述与标题同行
2. **新增 `PageToolbar`**（`apps/admin/src/components/common/PageToolbar.tsx`）
   - props：`filters? / summaryItems? / actions?`，全空返回 null
   - 在 `components/common/index.ts` 导出
3. **迁移 17 个页面**，按 design.md 的映射表逐页改：
   - 无 toolbar 的页面（AiSettings）：只改页头调用
   - 有 toolbar 的页面：actions / summaryItems 从 `AdminPageHeader` 移到 `PageToolbar`；原有独立筛选行并入 `filters`
   - UserManagement：删除与分页 `showTotal` 重复的摘要标签，筛选并入 toolbar
   - 页面顶层 `gap-6` / `space-y-6` 收紧为 `gap-4` / `space-y-4`
4. **检查旧 props 无残留**：`grep -rn "summaryItems\|AdminPageHeader" apps/admin/src/features` 确认所有调用点都已迁移、无 `actions=` 传给页头
5. **质量门**：依次运行
   - `pnpm --filter @starter/admin check-types`
   - `pnpm --filter @starter/admin lint`
   - `pnpm --filter @starter/admin format:check`
   - `pnpm --filter @starter/admin test`
6. **视觉抽查**：`pnpm --filter @starter/admin dev`（端口 2333），抽查至少 5 个页面覆盖四类：
   - 带操作按钮：Agents、AiProviders、FileList
   - 带筛选：UserManagement、FileList
   - 带摘要标签无按钮：Home、AuthorizationSettings
   - 无 toolbar：AiSettings、ProfileSettings（ProfileSettings 有摘要标签，归入上一类）
   - 检查：页头单行、工具栏左筛选右按钮、窄屏换行不溢出、旧卡片消失

## 验证命令

```bash
pnpm --filter @starter/admin check        # 类型 + Lint + Format 一次跑完
pnpm --filter @starter/admin test         # Vitest
grep -rn "actions=\|summaryItems=" apps/admin/src/features --include="*.tsx" | grep -v PageToolbar
```

## 风险与回滚点

- 每完成一组页面（约 5 个）跑一次 `check-types`，缩小排错范围。
- 全量改动一次提交；回滚即 revert。
- 改坏风险最高的文件：`AdminPageHeader.tsx`（公共契约）、`UserManagement.tsx` / `FileList.tsx`（筛选行并入 toolbar）。
