# ESLint 配置目录结构

- `packages/eslint-config/index.js`：基于 `@antfu/eslint-config` 的 flat config，并追加 `eslint-config-prettier`。
- `packages/eslint-config/prettier.config.js`：仓库统一的 Prettier 选项。
- 各应用的 `eslint.config.js`：只 re-export 共享默认配置。
- 根 `eslint.config.js`：供 workspace 根检查使用。

共享配置的忽略项覆盖 `node_modules`、`dist`、`.next`、`.turbo`、`.agents`、`.pi`、`.trellis`、coverage、migration snapshot JSON 和 Markdown。新增生成目录时优先在共享 config 增加明确 ignore，而不是每个应用重复写一套。

不要把应用源码、React 组件或环境变量读取逻辑加入这个包。
