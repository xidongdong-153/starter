# Admin 质量规范

## 必须通过的检查

修改 `apps/admin` 后依次运行：

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
```

`check-types` 同时检查 `tsconfig.app.json` 和 `tsconfig.node.json`。仓库级 `pnpm check` 还会通过 Turborepo 检查所有 workspace。

## 交互质量

- 查询页面显示加载态；失败时显示 `Alert` 和可执行的重试按钮；空结果交给组件的 `emptyText` 或页面空状态。
- mutation 期间禁用或显示 loading，避免重复提交。成功和失败都通过 Ant Design `App` 的 message/modal 反馈。
- 错误边界必须保留用户可执行的重试和返回首页操作，参见 `components/ui/ErrorBoundary.tsx`。
- 图标按钮要有 `aria-label` 或 Tooltip；移动菜单打开时锁定 body 滚动、聚焦首个链接并支持 Escape 关闭，参见 `layout/atoms/MobileMenuButton.tsx` 和 `layout/components/mobile-drawer/MobileDrawer.tsx`。
- 主题和语言切换不能只改变视觉状态，还要更新 `data-theme`、Ant Design locale 或 i18n 实例。

## 变更后的检查重点

新增 API query 时确认 query key 唯一、mutation 成功后的 cache 更新正确；新增路由时确认登录守卫、标签栏元数据和移动端导航都能得到该路由；新增表单时确认提交值经过 schema 对应的转换。
