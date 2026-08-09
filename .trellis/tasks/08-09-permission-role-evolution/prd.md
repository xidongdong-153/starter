# 规划权限与角色进阶路线

## Goal

基于当前已经实现的权限、用户和角色初版，复核归档任务 `explore-user-permissions` 的建议与实际代码，参考 Auth0 可验证的权限管理能力，产出适合通用单租户 TypeScript 全栈脚手架的进阶设计方向、阶段优先级和明确边界。本任务只做调研与规划，不修改产品代码。

## Background

- 归档任务建议首版采用全局 User -> Role -> Permission RBAC：权限取角色权限并集，不支持角色继承、通配符或用户直授权限。
- 归档任务建议 Better Auth session 只负责认证，API 授权以服务端数据库为准，Admin 的权限集合只用于界面和导航。
- 归档任务把 ABAC、Organization 多租户、复杂审计和共享缓存列为后续方向；这些建议需要结合当前实际实现重新判断。
- 用户已说明权限、用户和角色均已完成初版，希望明确后续进阶方向。

## Confirmed Findings

- 当前已实现四张 RBAC 表、精确 `resource:action` 权限、多角色权限并集、`requirePermission`、`/api/me/permissions`、Admin 路由/菜单/按钮控制和用户角色/角色权限替换接口。
- 当前 API 授权每次从 SQLite 读取最新关系；权限撤销在下一次受保护请求生效，前端权限 query 只影响界面状态。
- 当前 `admin` 是平台级特殊角色：自动获得全部已注册且未归档权限，不能按普通角色编辑；后续设计必须明确保留这一语义，或改成显式的平台管理员边界。
- 当前“角色管理”还没有角色创建、编辑、归档、恢复、删除和权限影响分析；权限目录也没有独立同步或生命周期接口。
- 当前用户管理以查询和角色分配为主，没有账号封禁、session 撤销、操作审计或 Admin 前端自动化测试。
- 当前没有组织、租户、资源范围策略、API key、M2M、FGA 或 token claim 扩展；Better Auth 只配置核心认证和用户创建 hook。
- 研究文件已写入 `research/current-implementation-audit.md`、`research/auth0-advanced-authorization.md` 和 `research/better-auth-boundaries.md`，外部结论均应以官方来源为准。

## Product Decision

- 用户选择通用单租户后台脚手架作为默认产品画像。
- 默认主线先补全平台管理员写入边界、授权审计和自动化验证，再实现角色生命周期与权限影响分析。
- Organization、多租户角色、API Key、M2M 和 FGA 只作为按业务条件启用的独立模块，不进入默认 schema 或接口。
- 用户已明确批准 `prd.md`、`design.md` 和 `implement.md`，当前任务已进入执行阶段；本次批准只用于完成规划交付，不授权实现后续产品功能。

## Requirements

### R1. 复核当前实现

- 对照归档任务检查当前 schema、授权中间件、用户与角色管理、前端权限控制、错误契约和测试。
- 区分已经实现、部分实现、尚未实现以及实现方向与旧建议不同的能力。
- 只根据源码和测试描述当前行为，不把旧任务的建议当作现状。

### R2. 对照 Auth0 能力

- 只使用可核验的 Auth0 官方资料，梳理 Core RBAC、Organizations、组织角色、细粒度授权、Management API、Actions、M2M/API access control、FGA 和审计治理中与脚手架直接相关的能力。
- 对每项能力判断当前脚手架应当近期默认、满足业务条件后增加，还是不作为内置能力，并说明进入条件、事实来源和代价。
- 区分 Auth0 控制面角色、业务 API 角色、Organization 角色、人类用户和机器身份，不把它们压进同一个角色表。
- 不以复刻 Auth0 Dashboard、Management API 或商业平台能力为目标。

### R3. 设计进阶路线

- 给出从当前初版到可维护 RBAC、授权治理、资源范围/条件授权、Organization 多租户和机器身份授权的阶段路线。
- 每个阶段写清用户价值、前置条件、数据模型或接口影响、风险、验收方式和停止继续扩展的判断条件。
- 优先评估当前模型内的角色生命周期、系统角色保护、授权变更审计、权限影响分析和 Admin 自动化测试，再讨论跨模型能力。
- 明确全局角色、资源范围、Organization 角色和平台级管理员的边界，避免多个角色事实来源。
- 说明通配符、角色继承、用户直授权限、策略 DSL、Redis/外部 PDP 等能力为何暂不作为默认设计，及何时需要重新评估。

### R4. 形成可执行规划

- 调研结果写入当前任务的 `research/`。
- 最终需求写入 `prd.md`，技术边界和推荐架构写入 `design.md`，后续执行顺序写入 `implement.md`。
- 本轮规划完成后先交由用户评审；获得明确批准前不运行 `task.py start`，也不修改 `apps/` 或 `packages/`。

## Out of Scope

- 本任务不实现新的权限功能、不生成 migration、不修改 Admin 页面。
- 不完整设计 Auth0 等价产品，不比较所有 IAM 或策略引擎。
- 不把多租户、角色继承、通配符、策略 DSL、Redis、外部授权服务、API Key 或 M2M 加入通用脚手架默认能力。

## Acceptance Criteria

- [x] 当前权限实现有源码与测试依据的能力清单，并与归档任务逐项对照。
- [x] Auth0 可借鉴能力按“近期默认能力、条件成熟后增加、脚手架不内置”分类，并附官方来源。
- [x] 路线图至少说明稳定 RBAC、资源范围/条件授权、Organization 多租户和治理能力的先后关系。
- [x] 每个阶段都有进入条件、交付内容、验证方式和暂不实施的边界。
- [x] 最终规划明确下一项最值得单独创建实现任务的能力，不把全部进阶功能合并实施。
- [x] `prd.md`、`design.md`、`implement.md` 完成后，由用户明确批准，才进入实现阶段。
