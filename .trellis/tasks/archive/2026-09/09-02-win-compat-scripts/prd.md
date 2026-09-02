# Windows 兼容与全仓脚本优化

## Goal

开发者在 Windows（家里）和 macOS（公司）都能用同一套 `pnpm` 脚本完成安装、开发、构建、检查、清理，同时消除 lint/format 的重复执行和各包配置的不一致。

## 背景：现状问题清单

梳理时已逐项核实（读源码 + 计时验证），分三类：

### A. Windows 上必挂的脚本

1. `apps/api` 的 `build` 用了 `NODE_OPTIONS=--max-old-space-size=8192 tsup ...` 内联环境变量语法，cmd 和 PowerShell 都不支持，`pnpm build` 第一行报错。`.env.example` 和 README 反而明确警告过不要这样写。
2. 全部 6 个包的 `clean` 都是 `rm -rf dist`（web 是 `rm -rf .next`）。pnpm 在 Windows 默认 script-shell 是 cmd.exe，没有 `rm` 命令。

### B. Windows 环境层面的坑

3. prettier 强制 `endOfLine: 'lf'`，但 `.gitattributes` 没有任何 eol 规则（`git check-attr` 验证为 unspecified）。Git for Windows 安装默认 `core.autocrlf=true`，新克隆检出 CRLF 后 `prettier --check` 全仓库报错。
4. `.env.example` 生成密钥的注释写 `openssl rand -base64 32`，Windows 不保证有 openssl。
5. `better-sqlite3` 预编译二进制从 GitHub Releases 下载，国内网络可能超时后回退 node-gyp 编译（需要 VS Build Tools + Python）。文档需要提示。
6. 其余链路已验证安全：dotenv-cli v11 内部用 cross-spawn（Windows 可正确拉起 .cmd shim）；测试用 `mkdtemp(tmpdir())`；存储路径用 `path.join`/`resolve`/`sep` 校验。

### C. 脚本本身的优化点

7. lint 和 format 双跑：根 `lint` = `eslint . && turbo run lint`，根目录 eslint 扫全仓库后 turbo 又对每个包再扫一遍；`format:check` 同理。实测：根 eslint 9.5s + turbo lint 4.7s；根 prettier 4.4s + turbo format:check 约 4s。约一半是重复功。
8. 根目录没有 `prettier.config.js`：根级文件（README.md、turbo.json、test-fixtures/*.json）走 prettier 默认配置（printWidth 80、双引号），与包内共享配置（printWidth 120、单引号）不一致。
9. 一致性小项：`apps/api` 没有 `eslint.config.js`（靠向上查根配置，行为一致但不统一）；`packages/eslint-config` 的 `clean` 清理一个该包根本不会产出的 `dist` 目录。

## Requirements

### R1 Windows 兼容（P0）

- R1.1 `.gitattributes` 追加 `* text=auto eol=lf`，保留现有 trellis journal 规则，不改动其他内容。
- R1.2 `apps/api` 的 `build` 用跨平台方式设置 `NODE_OPTIONS`（引入 `cross-env`），保持 8192 堆内存参数不变。
- R1.3 全部 6 个包的 `clean` 改用跨平台实现（引入 `rimraf`），清理目标不变。

### R2 Windows 环境文档（P1）

- R2.1 `.env.example` 的密钥生成注释补 Windows 可用的 node 等价命令。
- R2.2 README 增加 Windows 环境小节：Node 版本要求、`pnpm approve-builds`、better-sqlite3 预编译下载可能需要代理、无需修改 script-shell。

### R3 脚本收敛与一致性（P2）

- R3.1 根 `lint` 去掉 `&& turbo run lint`，只跑一次根目录 eslint；根 `format:check` 去掉 turbo 部分，只跑一次根目录 prettier。
- R3.2 `turbo.json` 删除 `lint`、`format:check` 任务定义（已确认仅根 package.json 调用，无 CI 引用）。
- R3.3 各包保留自己的 `lint`/`format`/`format:check` 脚本（供 `pnpm --filter` 单包使用和包内 `check` 使用），只是不再被根脚本重复触发。
- R3.4 根目录新增 `prettier.config.js`（re-export 共享配置），统一根级文件格式化规则。
- R3.5 补 `apps/api/eslint.config.js`（与其他包一致的 re-export）。
- R3.6 删除 `packages/eslint-config` 的 `clean` 脚本（该包无构建产物）。
- R3.7 `turbo.json` 的 `dev` 任务增加 `"dependsOn": ["^build"]`：`dev:web` 启动前自动构建 workspace 依赖（contracts/theme），消除 `pnpm clean` 后 dev 因 dist 缺失报 Build Error 的缺口（实施中用户实触发放大，验证修复）。

### 明确不做

- 不改 `check-types` 依赖 `^build` 的结构（exports 的 types 指向 dist，必须先构建，设计合理）。
- 不开 antfu 配置的 react 规则（共享配置目前 `react: false`，web/admin 实际没有 react-hooks 检查——这是已存在的 lint 规则缺口，属于规则决策，超出本次脚本优化范围，另行处理）。
- 不改 pnpm Windows script-shell 设置（cmd 兼容写法即可）。
- 不在 Mac 上无法验证的 Windows 行为留清单给用户回家实测。

## Acceptance Criteria

- [x] `pnpm install` 成功，`cross-env`、`rimraf` 通过 catalog 引入，各包 devDependencies 正确。
- [x] Mac 上 `pnpm --filter @starter/api build` 成功且产物与改动前等价（入口、格式、dts 一致）。
- [x] Mac 上 `pnpm clean` 全部 6 个包成功执行（rimraf 对不存在的目录不报错）。
- [x] `pnpm check`（check-types + lint + format:check）零错误通过。
- [x] lint/format:check 各只执行一遍：根 `pnpm lint` 输出不再包含 turbo task 汇总；`pnpm format:check` 同理。
- [x] 根级文件用共享 prettier 配置重排后 `pnpm format:check` 通过，重排 diff 只涉及根级文件（README.md、turbo.json、test-fixtures/*.json 等），包内文件零格式化 diff。
- [x] `.gitattributes` 含 `* text=auto eol=lf` 且 trellis journal 规则原样保留。
- [x] `apps/api/eslint.config.js` 存在且为标准 re-export；`packages/eslint-config` 不再有 `clean` 脚本。
- [x] README Windows 小节与 `.env.example` 注释更新完成，命令可直接复制执行。
- [x] `pnpm test` 通过（防意外回归）。
- [x] 删除 contracts/theme dist 后直接 `pnpm dev:web`：turbo 先自动构建依赖再启动，/flow 返回 200 无 Build Error。
- [x] 提供一份用户在 Windows 机器上的验证命令清单（install/check/build/clean）。

## Notes

- 实测数据（Mac，2026-09-02）：根 eslint 全仓 9.5s；根 prettier 全仓 4.4s；turbo run lint（5 缓存 + 1 执行）4.7s。
- 共享 ESLint 配置已确认对 cwd 不敏感（`typescript: true` 显式、react/vue 未启用、`enableCatalogs` 走 findUpSync），根目录单跑 eslint 与包内跑结果一致，收敛安全。
- dotenv-cli v11 用 cross-spawn 拉起子进程，Windows 兼容，无需替换。
