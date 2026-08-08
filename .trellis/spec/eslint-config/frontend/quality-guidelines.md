# ESLint 配置质量规范

## 当前规则

`index.js` 基于 `@antfu/eslint-config`，开启 TypeScript，关闭 formatter/Markdown 处理，再叠加 `eslint-config-prettier`。Prettier 负责格式化，ESLint 不重复处理 formatter 规则。

`prettier.config.js` 当前使用：`printWidth: 120`、`singleQuote: true`、`semi: false`、`trailingComma: 'all'`、LF 和 2 空格。仓库级 `.prettierignore` 排除 Trellis 生成的 `.agents`、`.pi` 和整个 `.trellis` 目录；这些文件不参与仓库级 Format 检查。

## 检查命令

```bash
pnpm lint
pnpm format:check
pnpm --filter @starter/eslint-config check-types
```

新增规则后必须覆盖至少一个 TS/TSX、一个 API TS 文件和一个 JS 配置文件；warning 也要留意，仓库脚本使用 `--max-warnings 0`。

不要把 Markdown ignore 误解为 spec 不需格式化；Prettier 仍会检查仓库中的 Markdown，除非路径被 `.prettierignore` 排除。
