# @starter/theme 后端边界规范

## 适用范围

`packages/theme` 没有后端业务代码。它提供主题色板、颜色计算函数、Ant Design token 和 CSS 入口，主要由 `apps/admin` 与 `apps/web` 使用。

后端可以安全复用无 DOM 的纯函数（例如 `hexToRgb`、`mixColors`），但当前 API 不依赖 theme。不要在 `apps/api` 或 Node-only 模块中导入 CSS、`applyTheme`、`document` 相关逻辑或 Ant Design 组件配置。

## 开发前检查

涉及共享颜色时先看 `src/palette.ts`、`src/color.ts` 和 package exports；涉及 Admin token 时再看 `src/antd.ts`。

## 质量检查

```bash
pnpm --filter @starter/theme check-types
pnpm --filter @starter/theme lint
pnpm --filter @starter/theme format:check
pnpm --filter @starter/theme build
```

主题包的改变可能影响两个浏览器应用，即使 API 没有变化也要运行 Admin/Web 的 type-check 和构建。

## 文件索引

- `directory-structure.md`：TS 源文件和 CSS 入口。
- `database-guidelines.md`：无数据库和用户配置持久化边界。
- `error-handling.md`：纯颜色函数的 fallback 行为。
- `logging-guidelines.md`：无日志和环境变量副作用。
- `quality-guidelines.md`：Node/后端使用时的检查。
