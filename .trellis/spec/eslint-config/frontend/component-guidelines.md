# ESLint 配置与组件边界

该包不创建组件规则的实现，也不导出 React 运行时组件。React 代码的 JSX/Hook 检查由共享 `@antfu/eslint-config` 处理，Admin 和 Web 只需 re-export 配置。

如果需要调整 JSX 相关规则，修改 `packages/eslint-config/index.js` 的共享规则，并验证 `apps/admin/src` 与 `apps/web/app` 的实际代码；不要在单个应用复制一份相同 config。

当前配置显式关闭了 `no-console`、import/perfectionist 排序、部分 node/global 规则等项目选择，新增规则前要避免与 `eslint-config-prettier` 或现有关闭项冲突。
