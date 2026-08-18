# Pi Session 存储基础设施

## Goal

接入 Pi Agent 与 SQLite Session backend，提供可注入的 Session Store adapter。该 adapter 使用独立 `agent-sessions.db` 保存 transcript、lane、tree 和 records，不读取或修改 Starter 主库。

本任务完成后还没有 Agent、Session 或 Run HTTP API；旧 Conversation runtime 保持可用。

## Background

父任务：`08-17-pi-agent-harness-foundation`。本任务是 S1，没有前置子任务。

Session adapter 中与 Run terminal entry 有关的字段以父任务共享契约为准：`.trellis/tasks/08-17-pi-agent-harness-foundation/research/harness-contracts.md`。

Starter 当前只依赖 `@earendil-works/pi-ai`。后续 Executor 和 Session API 都依赖 Pi Session repository，因此先独立完成依赖、环境变量、adapter、初始化和关闭行为。

## Requirements

### R1. 依赖与配置

- 在 workspace catalog 增加 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-session-backend-sqlite-node`。
- 两个新 package 与 `@earendil-works/pi-ai` 固定为同一精确版本。
- API 新增 `AGENT_SESSION_DATABASE_PATH`，开发默认值为 `./data/agent-sessions.db`。
- 测试 runtime 为每个用例注入独立临时 Session 数据库路径。

### R2. Session Store adapter

- 新建 `apps/api/src/infra/agent/pi-session-store.ts`。
- 通过 Pi 的公开 repository 和 Session API 实现 create、open、delete、读取 lane transcript、append message、append `starter.run.v1` CustomEntry、按 runId 查询 terminal entries 和 close。
- `cwd` 由 API bootstrap 固定提供；调用方不能传 storage path、ownerId 或任意 Pi metadata。
- adapter 不读取 Pi 私有表，不复制 migration、writer lease、FTS 或 branch cache。
- adapter 不依赖 Hono、Drizzle、Better Auth 或公开 DTO。

### R3. 生命周期

- `create-runtime.ts` 初始化 adapter，并把它作为 runtime dependency 提供给后续任务。
- runtime 关闭时先关闭 Pi repository，再关闭 Starter SQLite。
- 初始化或关闭失败必须保留原始 cause，并通过现有日志边界报告。

### R4. 隔离

- Session repository 不连接 `app.db`。
- 创建和删除 Pi Session 不改变 Conversation、Provider、Prompt、Skill 或审计表。
- 本任务不读取、迁移或删除旧 Conversation 数据。

## Acceptance Criteria

- [ ] 三个 Pi package 使用同一精确版本，Node engine 满足 package 要求。
- [ ] API 能在临时路径初始化并关闭 Pi Session repository。
- [ ] adapter 测试覆盖 create/open、append/replay、lane、`starter.run.v1` 写入与查询、delete 和 close。
- [ ] 两个临时数据库相互隔离，`app.db` 不出现 Pi 内部表。
- [ ] 测试结束后没有未关闭的 SQLite handle 或残留临时文件。
- [ ] 旧 Conversation smoke tests 保持通过。
- [ ] `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test` 和 `pnpm build` 全部通过。

## Out of Scope

- AgentDefinition、AgentRun 和 HarnessEvent contracts。
- Starter 主库的新业务表。
- Hono Route、SSE、Agent executor、Tool adapter 和 compaction 策略。
- 旧 Conversation runtime 或数据清理。
