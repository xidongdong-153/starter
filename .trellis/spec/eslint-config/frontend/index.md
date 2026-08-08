# @starter/eslint-config 前端工具规范

## 适用范围

`packages/eslint-config/` 提供 workspace 共享的 ESLint flat config 和 Prettier config。它不是运行时前端包，不包含 React 组件、hook 或应用状态。

## 开发前检查

1. 先读 `packages/eslint-config/index.js` 和 `prettier.config.js`。
2. 检查应用的 `eslint.config.js` 是否只做薄封装。
3. 新规则先确认是否适用于 Admin、Web、API 和 packages，避免把单一应用规则强加到全仓库。
4. 运行共享配置包和受影响应用的 lint、type-check、format check。

## 质量检查

```bash
pnpm --filter @starter/eslint-config check-types
pnpm --filter @starter/eslint-config lint
pnpm --filter @starter/eslint-config format:check
pnpm lint
pnpm format:check
```

## 当前入口

```js
// apps/admin/eslint.config.js
export { default } from "@starter/eslint-config";
```

根 `eslint.config.js` 从 `packages/eslint-config/index.js` 引入默认配置；Prettier 通过 package exports 的 `./prettier` 入口共享。

## 文件索引

- `directory-structure.md`：配置入口、应用包装和忽略目录。
- `component-guidelines.md`：共享 JSX 规则与应用组件边界。
- `hook-guidelines.md`：Hook lint 规则与运行时边界。
- `state-management.md`：配置包无状态和全仓库影响面。
- `type-safety.md`：JavaScript 配置的 checkJs 与依赖规则。
- `quality-guidelines.md`：ESLint、Prettier 和 workspace 检查。
