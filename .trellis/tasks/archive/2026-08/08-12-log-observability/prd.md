# admin 日志查看与日志可观测性优化

## Goal

对照课程《25-logging-observability》的可观测性原则，补齐 starter 项目的日志能力：请求日志带 userId 可按用户排查；关键业务分支写结构化事件日志；admin 后台内置日志查看页（列表 + 过滤 + 分页 + 按 requestId 展开链路）。

## Confirmed Facts

- API 已用 Pino 输出结构化 JSON；`LOGS_DIR` 配置后由 pino-roll 按天轮转写 `LOGS_DIR/app.YYYY-MM-DD.log`（默认未开启）。
- 已有 requestId 机制（`request-context.middleware.ts`），请求级 logger `c.var.logger` 带 requestId。
- `request-log.middleware.ts` 记录 `http.request.completed`（method/path/status/durationMs），无 userId。
- 认证后 `c.var.currentUserId` 可用，且 request-log 中间件取值晚于认证执行，补 userId 无额外成本。
- 用户状态变更已有数据库审计（`users.repository.ts` `insertAuditEvent`），但无结构化日志。
- 权限体系：`PermissionKeys`（contracts）为唯一来源；`createRequirePermission` 挂 `middleware: [requireAuth, ...]`；admin 在 `hasPermission` 中自动放行全部权限，新权限键无需绑 role_permissions，但需 migration 插入 permissions 表（is_system=1）。
- admin 为 Vite + React SPA：features/ 目录 + routes.tsx + records.ts 注册 + navigation.ts 菜单 + 前端权限守卫（`requireAdminRoutePermission` / `hasPermission`）。
- 现有规范：`.trellis/spec/api/backend/logging-guidelines.md`（logger 来源、脱敏、请求日志分级）、`authorization-guidelines.md`（权限挂载顺序、PermissionKeys 唯一来源）。

## Requirements

1. 请求日志补 userId：`request-log.middleware.ts` payload 增加 `userId`（未认证请求省略该字段）。
2. 业务事件日志埋点（route handler 用 `c.var.logger`，事件命名 `domain.action.result`）：
   - 用户状态变更：`users.status.changed`（info，含 actorId/targetUserId/from/to）；`from` 需 repository 返回结构调整。
   - 文件上传：`files.upload.succeeded`（info）/ `files.upload.failed`（AppError→warn，未知异常→error，含 err）。
3. API 日志查询接口：`system` 模块新增 `GET /api/system/logs`：
   - 权限：`requireAuth` + `createRequirePermission(db, SYSTEM_LOGS_READ)`；新权限键 `system:logs:read`（contracts + migration）。
   - 参数：`requestId`（链路精确过滤）、`level`（info/warn/error）、`query`（关键字，行 JSON 子串匹配）、`limit`（默认 100，最大 500）、`before`（time 游标倒序分页）。
   - 返回解析后的 Pino 行对象数组；`LOGS_DIR` 未配置时报 400；损坏行跳过。
4. admin 日志页（`apps/admin/src/features/system/`）：
   - 列表：时间/level/event/message/requestId/userId/durationMs；筛选：level、关键字、requestId；倒序分页（before 游标）。
   - 行点击展开同 requestId 全链路（时间正序）。
   - 路由 `/system/logs` 挂 `SYSTEM_LOGS_READ` 权限；菜单放 settings 组；i18n 文案。
5. 测试：API smoke（权限/过滤/分页/未配置 LOGS_DIR/损坏行）+ admin UI 测试（列表渲染/筛选/链路展开）。

## Acceptance Criteria

- [ ] 已认证请求的请求日志包含 userId；未认证请求不含该字段。
- [ ] 日志文件出现 `users.status.changed`、`files.upload.succeeded`、`files.upload.failed`，字段符合 Requirement 2。
- [ ] `GET /api/system/logs`：admin 200；非 admin 403；未登录 401；`LOGS_DIR` 未配置返回 400。
- [ ] `query`/`level`/`requestId` 过滤正确；`limit` 生效；`before` 分页不重不漏；损坏行不中断。
- [ ] admin 日志页可浏览、筛选、分页、展开 requestId 链路；无权限用户看不到菜单和路由。
- [ ] `pnpm --filter @starter/api test` 与 `pnpm check` 通过。

## Out of Scope

- Sentry / 外部错误聚合平台。
- 指标埋点（Analytics Engine 类）。
- 日志推送到外部平台（Logpush / Loki / Axiom）。
- 日志页自动刷新（SSE/tail）。
- 登录/注册等 Better Auth 事件埋点。

## Key Decisions

- 单任务顺序执行 A→B→C→D→测试（交付物耦合紧密，拆 child 收益低）。
- 新权限键 `system:logs:read` 默认仅 admin 可获取（admin 自动放行；operator/viewer 不绑定）。
- 日志查询为只读、尽力而为：损坏行跳过、收集满 limit 即停、不追求大日志量下的流式优化。
- 埋点位置选 route handler（`c.var.logger` 已带 requestId），不改 service 签名；唯一例外是 users repository 返回结构加 `from` 字段。

## Risks / Deferred

- `users.repository.ts` 返回结构调整需同步 service/route 与既有测试（`user-status.smoke.test.ts` 等）。
- 日志文件读取为整读+按行解析，日志量大时性能一般；个人项目可接受，后续可换流式。
- 权限键发布流程：contracts + migration + 接口 + 前端同步，若只发部分会不一致（本次一次性全发）。
