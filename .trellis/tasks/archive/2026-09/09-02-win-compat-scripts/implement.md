# 执行计划

## 前置

- [x] 确认工作区干净（`git status`），基于 main。

## 步骤 1：依赖引入

- [x] `pnpm-workspace.yaml` catalog 增加 `cross-env: ^7.0.3`、`rimraf: ^6.0.1`。
- [x] `apps/api` devDeps 加 `cross-env: "catalog:"`、`rimraf: "catalog:"`；web/admin/contracts/theme devDeps 加 `rimraf: "catalog:"`。
- [x] 执行 `pnpm install`，确认 lockfile 更新且无版本冲突。

验证：`pnpm install` 退出码 0；`pnpm ls rimraf cross-env` 可解析。

## 步骤 2：P0 脚本改造

- [x] `apps/api` build：`cross-env NODE_OPTIONS=--max-old-space-size=8192 tsup src/index.ts src/app.ts src/rpc.ts src/rpc/chat.ts src/rpc/flow.ts --format esm --dts --out-dir dist --clean`（参数原样保留）。
- [x] 6 个包 clean 换 rimraf：api/web/admin/contracts/theme 为 `rimraf dist`（web 为 `rimraf .next`）；`packages/eslint-config` 直接删除 clean 脚本。
- [x] `.gitattributes` 末尾追加 `* text=auto eol=lf`。

验证：

```bash
pnpm --filter @starter/api build
pnpm clean
```

build 产物目录 dist 齐全；clean 全部成功。

## 步骤 3：P2 脚本收敛

- [x] 根 `package.json`：`lint` 改为 `eslint --no-error-on-unmatched-pattern --max-warnings 0 .`；`format:check` 改为 `prettier --check .`。
- [x] `turbo.json` 删除 `lint`、`format:check` 两个任务定义。
- [x] 新建根 `prettier.config.js`：`export { default } from '@starter/eslint-config/prettier'`。
- [x] 新建 `apps/api/eslint.config.js`：`export { default } from '@starter/eslint-config'`。

验证：

```bash
pnpm format
pnpm lint
pnpm format:check
```

`pnpm format` 后 diff 只允许出现在根级文件；lint 单次执行无 turbo 汇总输出。

## 步骤 3.5：dev 依赖自动构建（实施中追加）

- [x] `turbo.json` 的 `dev` 任务增加 `"dependsOn": ["^build"]`。
- 背景：验证 `pnpm clean` 后用户跑 `dev:web` 触发 Build Error——web 的 Turbopack `resolveAlias` 直读 contracts/theme 的 dist，而 dev 从不构建它们。
- 验证：删两个包 dist 后直接 `pnpm dev:web`，turbo 先构建依赖（缓存命中秒级），`/flow` 返回 200。

## 步骤 4：P1 文档

- [x] `apps/api/.env.example` 密钥注释补：`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`。
- [x] README 增加 Windows 小节：Node >= 22.19、`pnpm approve-builds`、better-sqlite3 预编译下载可能需代理、行尾已由 .gitattributes 固定无需改 git 配置。
- [x] README/AGENTS.md 中涉及 `rm -rf`、`NODE_OPTIONS` 的既有描述与新行为核对一遍（README 第 41 行 NODE_OPTIONS 说明仍准确，保留）。

## 步骤 5：全量检查

```bash
pnpm check
pnpm test
```

- [x] check-types、lint、format:check 零错误。
- [x] test 全绿。
- [x] `git diff --stat` 复核：改动范围 = 设计清单列出的文件 + 根级文件格式化重排 + pnpm-lock.yaml，无其他文件。

## 步骤 6：收尾

- [x] 按 Trellis 流程运行 trellis-check。
- [x] 更新 spec（如 lint 单跑约定值得记录）。
- [x] 向用户提交改动摘要，确认后 commit（遵守 Git 提交确认规则）。
- [x] 输出 Windows 实机验证清单：`pnpm install` → `pnpm check` → `pnpm build` → `pnpm clean`。

## 回滚点

- 步骤 1-2 后：还原 package.json + pnpm-workspace.yaml + lockfile 即回滚。
- 步骤 3 后：还原根脚本与 turbo.json；根级格式化文件可保留或一并还原。
- 步骤 4-5 无风险，随时可改。
