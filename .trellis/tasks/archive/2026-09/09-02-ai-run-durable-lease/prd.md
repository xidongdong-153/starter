# 阶段A：持久执行所有权与启动门禁

## Goal

把 Session lane 的执行排他从进程内 `ActiveRunRegistry` 移到 Starter SQLite 持久 lease，并把影响执行所有权的恢复扫描变成启动门禁。完成后，两个共享数据库的 runtime 不能同时执行同一 `sessionId + lane` 的 Run，进程重启后的恢复在新请求进来之前完成。

任务来源：`.trellis/tasks/09-02-api-ai-agent-architecture-research/implement.md` 阶段 A。设计依据：同任务 `design.md` 第 5、6 节与 `research/current-api-ai-gap-analysis.md` P0-1、P0-3。

## Confirmed Facts

- `ActiveRunRegistry` 用四个进程内集合保存 lease 与 handle；`run.service.ts` 在创建 Run row 前只调用它的 `reserve`。
- 数据库对 `(session_id, lane, status)` 只有普通索引；跨实例可以各自 reserve 同一 lane 并各建一个非终态 Run。
- `createAiServices` 以 fire-and-forget 执行 Session 一致性检查和 `recoverInterrupted`；路由创建后立即接收请求，旧 `running` Run 可能与新请求同时操作同一 lane。
- Pi SQLite backend 自带单 session 单写者租约，会拒绝第二个写者；但 Starter 主库的 `AI.SESSION_BUSY` 语义和 Run 终态写入不受它保护。
- SQLite 已启用 WAL，多连接读写同一文件可行；better-sqlite3 为同步事务。
- `parseEnv` 已有 `APP_INSTANCE_ID`（默认 `local`），可直接作为 lease 的 `ownerId`。

## Requirements

- R1 部署模型：数据模型按多实例设计（`ownerId` 使用 `APP_INSTANCE_ID`），实际部署维持单 API 实例；session affinity 与独立 worker 不在本阶段实现。
- R2 新增持久 lease 表，主键 `(sessionId, lane)`，字段包含 `ownerId`、`fencingToken`、`leaseUntil`、`heartbeatAt`、`acquiredAt`。
- R3 lease 领取、续租、释放全部使用条件更新：过期 lease 允许被新 owner 接管并递增 `fencingToken`；未过期时第二个 owner 领取失败；owner 不匹配或已过期的续租、释放无效果。
- R4 Run row 记录 acquire 时拿到的 `fencingToken`；终态提交在数据库事务内校验 token，过期 owner 只能把 Run 写成 `interrupted`，不能写正常终态。
- R5 执行期间周期性续租；续租失败（已被接管或过期）时 executor 主动中止，按现有 `AI.RUN_INTERRUPTED` 语义收尾。
- R6 `recoverInterrupted` 扫描与过期 lease 清理进入 AI readiness：Run 接收入口在 readiness 完成前等待，完成后不再阻塞；`GET /active-run` 与控制接口不再读到未恢复的旧 Run。
- R7 `ActiveRunRegistry` 降级为 controls 与 subscriber 的进程内缓存：排他判断改为持久 lease；进程内快速失败路径保留；`get`、`getBySessionLane`、`abort`、`steer`、`followUp` 行为不变。
- R8 `AI.SESSION_BUSY` 的错误码、HTTP 状态与触发场景（同 lane 已有活跃 Run）对外不变，只把判定来源换成持久 lease。
- R9 lease TTL 与续租间隔使用代码常量（TTL 90s、续租 30s），写入 schema 注释，不做环境变量配置。

## Out Of Scope

- 不引入 attempt、step、checkpoint（阶段 C）。
- 不做 resolved manifest 与资源 revision（阶段 B）。
- 不实现 session affinity 路由、独立 worker 进程或跨机协调服务。
- 不改 Pi Session backend 自身的写者租约。
- 不改 `/health` 语义（进程存活检查）；AI readiness 是内部门禁。
- 不增加 lease 相关环境变量。

## Acceptance Criteria

- [x] migration 生成并执行成功，新表结构与索引符合 R2。
- [x] 两个独立 runtime（不同 `APP_INSTANCE_ID`）共享同一数据库启动同 lane Run：第一个成功，第二个得到 `AI.SESSION_BUSY`，主库只产生一个非终态 Run。
- [x] lease 过期后新 owner 接管成功，`fencingToken` 递增；旧 owner 续租与释放无效果。
- [x] 被接管的旧 owner 提交终态时，Run 结果为 `interrupted`，不是 succeeded/failed；正常 owner 的终态提交不受影响。
- [x] 进程重启场景：readiness 恢复完成后才接受新 Run；恢复期间到达的 startRun 请求被等待而非直接拒绝或并行执行。
- [x] `GET /active-run` 在 readiness 完成后不再返回重启前的旧 handle 语义（registry 为空，返回 `AI.RUN_NOT_ACTIVE` 行为保持）。
- [x] 现有测试全量通过：`ai-agent-runs`、`active-run-registry`、`ai-run-idempotency`、`ai-cross-product-runtime`、`pi-agent-executor` 等，无语义回归。
- [x] `pnpm --filter @starter/api check-types`、`lint`、`format:check`、`test` 全部通过。
- [x] 涉及 migration：`db:generate`、`db:check`、`db:migrate` 执行通过。

## Notes

- 阶段顺序依据调研任务 implement.md：A 先行，B、C 依赖 A 的 lease 与 fencing 基础。
- 设计细节见本任务 `design.md`，执行清单见 `implement.md`。
