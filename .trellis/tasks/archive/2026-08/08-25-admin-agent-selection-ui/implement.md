# 实施计划

1. 在 `Agents.tsx` 增加页面私有的可折叠双栏资源选择器，支持搜索、滚动资源列表、checkbox 多选、已选数量和展开后单项移除。
2. 将技能和工具的两个 `Select mode="multiple"` 替换为资源选择器，保留现有过滤条件、加载状态和表单字段值。
3. 调整资源展示文案与无障碍标签，确保工具版本和技能/工具描述可检索、可区分。
4. 更新 `ai-agents.test.tsx`，覆盖新建默认空值、编辑回填、搜索、移除和同名工具版本冲突提交。
5. 按顺序执行：
   - `pnpm --filter @starter/admin check-types`
   - `pnpm --filter @starter/admin lint`
   - `pnpm --filter @starter/admin format:check`
   - `pnpm --filter @starter/admin test`
6. 使用 `trellis-check` 做最终范围、数据流和交互状态检查。

## 风险与回滚点

- 选择器替换可能影响现有测试定位方式，先更新组件语义和测试，再运行 Admin 检查。
- 表单值不能从结构化引用退化为展示对象；提交前检查 `toolRefs` 仍能还原精确版本。
- 若双栏布局在 560px Drawer 中造成移动端溢出，保留同一组件的数据流，改为窄屏上下布局。
