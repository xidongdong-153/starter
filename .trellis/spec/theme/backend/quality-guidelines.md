# Theme 后端质量规范

运行主题包检查：

```bash
pnpm --filter @starter/theme check-types
pnpm --filter @starter/theme lint
pnpm --filter @starter/theme format:check
pnpm --filter @starter/theme build
```

如果后端新增 theme 的纯函数消费，确认代码在 Node 环境不触碰 `document` 或 CSS import，并运行 API check-types。不要把 Ant Design peer dependency 变成 API 运行时依赖。
