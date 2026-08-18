# Pi Session 存储基础设施实施计划

## 前置条件

- 父任务保持 `planning`。
- 本任务没有前置子任务。
- 启动前重新核对 Pi package 当前已安装版本和公开导出。

## 执行步骤

### 1. 建立基线

- [x] 运行 `git status --short`，记录已有改动。
- [x] 运行 `pnpm check-types`、`pnpm lint`、`pnpm format:check` 和 `pnpm test`。

### 2. 接入依赖与 env

- [x] 在 catalog 增加两个 Pi package，并与 `pi-ai` 固定同一版本。
- [x] 更新 `apps/api/package.json` 和 lockfile。
- [x] 增加 `AGENT_SESSION_DATABASE_PATH` 的 env schema 和 `.env.example`。
- [x] 更新 API 测试 helper，为每个 runtime 注入临时 Session DB。
- [x] 运行 `pnpm install` 和 API 类型检查。

### 3. 实现 adapter

- [x] 新建 `infra/agent/pi-session-store.ts` 和必要的窄接口。
- [x] 实现 create、open、delete、transcript、append message、append `starter.run.v1` CustomEntry、按 runId 查询 terminal entries 和 close。
- [x] 覆盖 terminal entry 缺失、唯一、重复和错误 data 的原样返回；S1 不决定恢复状态。
- [x] 固定 cwd，拒绝外部 storage path 和任意 metadata。
- [x] 不导入 Drizzle、Hono 或 contracts。

### 4. 接入 runtime 生命周期

- [x] 在 `create-runtime.ts` 初始化 Session Store。
- [x] 把 adapter 注入 runtime dependency，不挂载新 Route。
- [x] 更新关闭顺序，确保 Pi repository 正常关闭。

### 5. 测试

- [x] 覆盖 create/open、append/replay、lane、terminal CustomEntry、delete 和重复 close。
- [x] 验证两个临时 Session DB 隔离。
- [x] 验证 `app.db` 不含 Pi 表，旧 Conversation 数据不变。
- [x] 验证测试结束后目录可以删除。

### 6. 质量门

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
git diff --check
```

- [x] 使用 `trellis-check` 核对本任务范围。
- [ ] 未经用户确认，不提交、不推送、不归档。

## 回滚点

- 依赖安装失败：停在失败点，不更换 Pi package 或自行实现 Session backend。
- adapter 测试失败：保留错误证据，不接入 runtime。
- runtime 接入失败：恢复本任务新增装配，旧 Conversation runtime 应继续通过测试。
