# ESLint 配置与状态边界

`@starter/eslint-config` 是无状态配置模块：不读取 localStorage、不维护 React Query cache、不创建 Zustand store。它只导出 ESLint/Prettier 配置对象。

配置修改的影响面是整个 workspace。运行 `pnpm lint` 和 `pnpm format:check` 验证 Admin、Web、API、contracts、theme 以及根配置，而不是只检查配置包自身。
