# ESLint 配置类型安全规范

共享 ESLint 配置使用 JavaScript ESM；`packages/eslint-config/tsconfig.json` 开启 `allowJs` 和 `checkJs`，因此配置对象的导入、导出和 option shape 要保持可被 TypeScript 检查。

```js
/** @type {import('prettier').Config} */
export default {
  arrowParens: "always",
  printWidth: 120,
  semi: false,
  singleQuote: true,
};
```

不要用动态字符串拼接包名或规则名来绕过类型检查；新增插件或规则时先确认依赖已写入 `packages/eslint-config/package.json`，共享依赖版本写入 workspace catalog。
