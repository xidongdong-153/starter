# RBAC 治理演进

## Goal

给已经可用的全局 RBAC 补上两项缺失的治理能力：授权写操作的平台管理员边界，以及授权变更的可查询历史。同时补上 Admin 侧当前完全缺失的自动化测试基础。

本任务是父任务，只承载共同需求、子任务顺序和最终集成验收，不直接实现产品代码。

## Background

归档任务 `08-09-permission-role-evolution` 完成了调研与路线设计，结论是当前不扩大权限语法、不引入 Organization/ABAC/FGA，先解决"谁能扩大权限"和"变更如何追查"。

该任务的 `design.md` 第 11 节建议创建单个 `authorization-governance-foundation`，包含八项交付。本任务采用拆分方案，理由：

- 原范围横跨 `packages/contracts`、`apps/api`、`apps/admin` 三个包，含一个 migration，还要新建前端测试基础设施，一次性验证不可控。
- 原范围的回滚点混在一起：测试基础设施、行为收紧、追加式审计表的回滚方式完全不同。
- 拆分后每个子任务可独立规划、实现、检查和归档。

## Source Requirements

以下需求来自归档任务的 `prd.md` 和 `design.md`，是三个子任务的共同来源。

### SR1. 平台管理员写入边界

- `admin` 是平台根角色。所有 HTTP 授权控制面写操作只允许活动 `admin` 执行。
- `authorization:manage` 不是可安全委派的管理权限。route 层的 permission 检查只负责尽早拒绝，不是最终依据。
- actor 的平台管理员身份必须在写 transaction 内重新读取，不能使用 transaction 外的快照。
- transaction 提交后必须至少保留一个活动平台管理员。
- `authorization:read` 和后续的审计只读 permission 仍可单独分配，不要求持有者是 `admin`。

### SR2. 授权变更审计

- 新增追加式审计表，只记录成功且实际改变状态的运行时授权写入。
- 一次 mutation 只写一条事件。before 与 after 相同时按幂等成功返回，不重写关系也不写事件。
- `actor_type` 至少区分 `user` 和 `system`。`request_id` 对 CLI 和 hook 可空。
- 事件构造器按 action 明确选择字段，不序列化完整数据库 record，不写入密码、token、cookie 或文件内容。
- contracts 按 action 定义带判别字段的审计 DTO。Admin 不接收原始 JSON 字符串，也不在组件内自行解析。
- 平台管理员检查、关系写入和审计写入必须在同一 transaction 中判断或提交。任一步失败都不产生部分结果。

### SR3. Admin 自动化验证

- `apps/admin` 当前没有任何测试文件，根目录 `pnpm test` 固定只跑 API。
- 权限相关的路由、菜单、标签、按钮和错误状态目前只有人工验收。
- 新增的 Admin 测试必须进入根目录 `pnpm test`，不能游离在质量门禁之外。

## Task Map

| 顺序 | 子任务                              | 范围                            | 独立验收方式                      |
| ---- | ----------------------------------- | ------------------------------- | --------------------------------- |
| S1   | `08-09-admin-test-harness`          | 仅 `apps/admin` 测试基础设施与测试 | 新增测试全绿，`pnpm test` 覆盖 Admin |
| S2   | `08-09-platform-admin-write-boundary` | `apps/api` + `packages/contracts` | API smoke test 验证提权被拒       |
| S3   | `08-09-authorization-audit-trail`   | 三包 + 一个 migration           | 审计事件与最终关系一致            |

顺序说明（不是依赖系统，各子任务 `prd.md` 自行写明前置条件）：

- S1 放第一位，因为 S2 和 S3 都会改 Admin，当前没有任何前端回归证据。S1 是安装测试基础设施的唯一合适时机。
- S2 在 S3 之前，因为 S2 一次性引入 repository 写入上下文，S3 只往 transaction 里追加审计插入，避免同一批函数签名改两遍。
- S3 依赖 S2 的 `AuthorizationWriteContext` 和平台管理员检查已经就位。

## Cross-Child Acceptance Criteria

以下条件在三个子任务全部完成后统一验收，不在单个子任务内判定完成。

- [ ] 普通角色即使被授予 `authorization:manage`，也不能替换任何用户角色或修改任何角色 permission。
- [ ] 用户角色替换、角色 permission 替换、新用户默认角色初始化和 `auth:bootstrap-admin` 的每次实际变化各产生一条可查询审计事件。
- [ ] 幂等无变化请求不重写关系，也不产生审计事件。
- [ ] 401、403、409、500 保持可区分，各有稳定 error code。
- [ ] 根目录 `pnpm test` 同时执行 API 与 Admin 测试，全部通过。
- [ ] `pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm --filter @starter/api db:check` 全部通过。
- [ ] 现有四张 RBAC 表、权限并集算法和每请求查库策略未被修改。

## Out of Scope

本父任务及三个子任务都不包含：

- 自定义角色创建、编辑、归档、恢复和权限影响分析（归档任务的阶段 2，另建任务）。
- Better Auth Admin plugin 或 Organization plugin。
- 用户直授权限、通配符 permission、角色继承、显式 deny、策略 DSL。
- API Key、M2M、FGA、OpenFGA。
- Redis 或进程内权限缓存。
- 资源范围条件授权和 `:any` 类 elevated permission。
- 失败和拒绝操作的安全审计日志（首版审计只记录成功变更）。

## Acceptance Criteria

- [ ] 三个子任务各自完成 PRD、design、implement，并独立通过检查与归档。
- [ ] 上述 Cross-Child Acceptance Criteria 全部满足。
- [ ] `.trellis/spec/api/backend/authorization-guidelines.md` 和 `.trellis/spec/admin/frontend/authorization-guidelines.md` 更新到与最终实现一致。
