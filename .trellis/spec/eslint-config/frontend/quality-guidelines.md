# ESLint 配置质量规范

## 检查执行结构（2026-09-02 收敛后）

`pnpm lint` 和 `pnpm format:check` 由根脚本单进程跑全仓库，不再拼接 `turbo run lint` / `turbo run format:check`。原因：根目录 eslint/prettier 已覆盖包内文件（prettier 按文件就近解析 `prettier.config.js`；共享 ESLint 配置对 cwd 不敏感，`typescript` 显式开启、react/vue 未启用、catalogs 检测走 `findUpSync`），包内再跑一遍是纯重复。包内保留 `lint` / `format` / `format:check` 脚本，仅供 `pnpm --filter <pkg>` 单包操作和包内 `check` 使用。往根脚本重新拼接 turbo 部分前，先确认重复执行的成本。

## 跨平台脚本约定

`package.json` scripts 只允许跨平台原语。Windows 上 pnpm 默认用 cmd.exe 执行脚本，以下写法会直接报错：

- `rm -rf <dir>`：cmd 没有 `rm`，用 `rimraf <dir>`（catalog 引入）
- `NODE_OPTIONS=... <cmd>` 内联环境变量：cmd 和 PowerShell 都不支持，用 `cross-env`（catalog 引入）或经 `.env` 文件由 `dotenv-cli` 传给子进程（仓库既有模式，见 `apps/api/.env.example` 的 NODE_OPTIONS 注释）

行尾由仓库根 `.gitattributes` 的 `* text=auto eol=lf` 固定，不依赖各端 git 的 autocrlf 配置。Prettier 强制 `endOfLine: 'lf'`，两端必须配合。

## 新包配置清单

每个 app/package 必须配齐两个薄封装配置文件，缺一个就会让该包退回 prettier 默认格式或向上找根配置（apps/api 曾因此整包使用默认格式，2026-09 统一时重排了 271 个文件）：

```js
// eslint.config.js
export { default } from '@starter/eslint-config'
// prettier.config.js
export { default } from '@starter/eslint-config/prettier'
```

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
