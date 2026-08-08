# ESLint 配置与 Hook 边界

共享配置包不包含 React hook。Hook 规则由 ESLint 插件检查应用代码，实际 hook 例子位于 `apps/admin/src/hooks/` 和 `apps/web/hooks/`。

修改 lint 规则时，检查它不会误判 `packages/eslint-config/index.js`、API middleware 或共享 TS 工具。不要在配置包中加入运行时 Hook helper，也不要用 ESLint rule 代替应用中的 effect 清理逻辑。
