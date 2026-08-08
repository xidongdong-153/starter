# Contracts 目录结构

该包目前只有 `packages/contracts/src/index.ts` 和对应的 `tsconfig.json`、构建配置，没有按 domain 拆分文件。新增契约前先判断是否仍能保持单文件清晰；不要把 API route、Drizzle schema、repository 或 React 组件放入这里。

导出顺序按边界分组：error code 与 response 类型、response builder、Zod 输入 schema、输入/输出 DTO。API 通过 `@starter/contracts` 根导入，package exports 的 development 条件指向 `src/index.ts`，构建产物指向 `dist/index.js`。

如果未来拆分文件，必须保持根入口导出稳定，并同步 `packages/contracts/package.json` 的 exports 和相关应用的 imports。
