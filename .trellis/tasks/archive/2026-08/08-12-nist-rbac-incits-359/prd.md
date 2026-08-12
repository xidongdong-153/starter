# NIST RBAC 标准（INCITS 359）调研与落地

## Goal

调研 NIST RBAC 标准（INCITS 359-2012）并落地其中适合当前脚手架的能力。标准分三层：Core（用户-角色-权限 + session）、Hierarchical（角色继承）、Constrained（静态/动态职责分离）。当前脚手架已有完整的 Core RBAC 数据模型和角色生命周期，本次产出标准映射调研报告，并落地 Constrained 层中的静态职责分离（SSD）。

## Confirmed Facts

- 已实现：`roles` / `permissions` / `user_roles` / `role_permissions` 四张表 + `authorization_audit_events` 审计表（`apps/api/src/modules/authorization/authorization.schema.ts`）；多角色权限并集，`requirePermission` 每次请求查库。
- 已有治理保护：平台管理员写入边界（事务内复核）、系统角色不可改/不可归档、最后一名平台管理员保护、角色生命周期、影响分析、审计、`/api/me/permissions`。
- 当前 `user_roles` 是"用户 ↔ 角色"静态分配，没有 NIST 的 session（激活角色子集）概念；权限计算总是取全部未归档角色的并集。
- 历史规划（归档任务 `08-09-permission-role-evolution`）明确：角色继承、通配符权限、策略 DSL、外部 PDP 近期不做。

## Requirements

### R1. 标准调研报告

- 产出 `research/nist-rbac-incits-359.md`：梳理 INCITS 359 的 Core / Hierarchical / Constrained 三层定义、SSD 与 DSD 的正式语义、角色基数等约束类型。
- 把标准元素逐项映射到当前脚手架：已实现 / 部分实现 / 本次落地 / 明确不做（含理由）。
- 外部结论标注来源（标准文档、权威解读），无法核验的写成待确认项。

### R2. 静态职责分离（SSD）落地

- 互斥角色组定义在 `packages/contracts` 代码常量中（seed 预置），无数据库表、无管理接口。
- 语义：组内角色数 >= 2 时两两互斥（目标角色集至多出现一个）；组内角色数 == 1 时为独占角色（持有该角色时不能持有任何其他角色）。
- 预置互斥组：`[['admin']]`，即 admin 为独占角色，与平台根角色语义一致。
- 校验发生在 `replaceUserRoles` 写事务内（幂等短路之后），违反时拒绝写入、用户角色不变。
- 存量数据不扫描、不自动修改；无变化的幂等提交放行。

### R3. 错误契约与前端

- 新增错误码 `AUTH.ROLE_CONFLICT`（HTTP 403），OpenAPI 的 `replaceUserRoles` 403 响应同步补充。
- Admin 角色分配失败展示后端中文文案（现有 `ApiRequestError` 机制），不新增前端特判。

## Acceptance Criteria

- [x] `research/nist-rbac-incits-359.md` 完成：三层结构、元素映射表、SSD 语义说明、来源可核验。
- [x] 给用户分配 `[admin, operator]` 返回 403 `AUTH.ROLE_CONFLICT`，用户角色不变（smoke test）。
- [x] 给用户分配 `[admin]` 成功；分配 `[operator, viewer]` 成功（smoke test）。
- [x] 幂等提交（无变化）成功，不报互斥错误（smoke test）。
- [x] 存量违规数据不被扫描或自动修改。
- [x] `pnpm check` 与 `pnpm test` 全绿；无 migration、无 schema 变更。

## Out of Scope

- DSD（动态职责分离）：依赖 session 激活角色概念，当前无此模型；管理后台单会话固定身份，与 SSD 实际效果等价。调研报告说明未来引入条件。
- 角色继承（Hierarchical RBAC）、cardinality（角色基数）：与既有规划一致，调研报告说明理由。
- 通配符权限、用户直授权限、策略 DSL、Organization / 多租户 / FGA。
- 互斥组的运行时管理接口与 Admin 管理页。

## Notes

- 无 migration、无 schema 变更，回滚成本低。
- 文案编写遵循 `xdd-plain-docs` 技能。
