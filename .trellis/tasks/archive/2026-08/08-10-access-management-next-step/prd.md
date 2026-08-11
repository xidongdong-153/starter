# 自定义角色生命周期与影响分析

## Goal

让平台管理员能够在 Admin 中创建和维护自定义角色，并在修改权限或归档角色前查看受影响范围。所有角色写入继续使用现有平台管理员 transaction 检查和授权审计，不增加新的授权事实来源。

## Background

- 用户已选择“自定义角色生命周期与影响分析”作为下一项能力。
- 归档任务 `08-09-permission-role-evolution` 已完成现状审计和角色生命周期设计。
- `08-09-rbac-governance` 任务树已经实现平台管理员 transaction 内检查、最后一个平台管理员保护、授权变更审计和 Admin 自动化测试。
- 当前 `roles` 表已经包含 `key`、`name`、`description`、`isSystem` 和 `archivedAt`，但 API 和 Admin 只支持查询活动角色及替换角色 permission。
- 当前 permission 由 `packages/contracts` 的 `PermissionKeys` 注册，并通过 migration 写入数据库。后台不能创建任意 permission。

## Product Decision

- 本任务只实现自定义角色生命周期与影响分析。
- 用户账号停用、恢复、邀请和 Session 撤销后续单独立项。
- permission 继续使用代码注册目录，不增加运行时创建、改名或删除。
- 角色不提供物理删除；停用使用归档，重新启用使用恢复。

## Requirements

### R1. 创建自定义角色

- 平台管理员可以创建自定义角色，并同时设置名称、可选描述和初始 permission 集合。
- 创建表单根据角色名称生成 role key 建议值；管理员在提交前可以确认或修改。管理员手动修改 key 后，名称变化不能再覆盖该值。
- 中文名称或其他无法生成有效 ASCII key 的名称不做拼音转换，必须由管理员明确填写 key。
- role key 使用现有 `roleKeySchema` 校验，全局唯一，创建后不可修改。
- 自定义角色写入 `roles` 和 `role_permissions`，不增加平行角色表。
- 创建和初始 permission 必须在同一 transaction 中提交，并写一条 `role.created` 审计事件。
- 重复 role key 返回稳定的 409 error code，不产生角色、permission 关系或审计事件。

### R2. 修改角色

- 平台管理员可以修改自定义角色的名称和描述。
- metadata 修改与 permission 替换使用不同接口。
- metadata 实际变化时写一条 `role.updated` 审计事件；内容相同时按幂等成功处理，不写事件。
- 现有角色 permission 替换接口继续写 `role_permissions.replaced`。
- role key 不能通过任何更新接口修改。

### R3. 角色归档与恢复

- `admin`、`operator`、`viewer` 的 key 和生命周期受保护，不能归档、恢复或删除。
- 自定义角色存在用户分配时不能归档，返回稳定的 409 error code 和分配用户数量。
- 归档提交必须在 transaction 内重新检查用户分配，不能只信任之前的影响查询结果。
- 归档角色不能分配给用户，也不参与 `/api/me/permissions` 和 API permission 判断。
- 恢复角色保留归档前的 permission 集合，不自动增加任何用户角色关系。
- 实际归档和恢复分别写一条 `role.archived`、`role.restored` 审计事件；重复操作不写事件。

### R4. 影响分析

- 角色影响查询至少返回该角色当前关联的现存用户数量。
- permission 影响查询至少返回能提供该 permission 的活动角色 key，以及通过这些角色获得该 permission 的去重现存用户数量。
- permission 影响必须包含 `admin` 自动获得全部活动注册 permission 的特殊规则，不能只读取 `role_permissions`。
- 多角色重叠用户只计算一次。
- 影响查询只用于提示和预览，不能替代写 transaction 内的最终校验。

### R5. Admin 管理体验

- 授权管理页支持创建、修改、查看影响、归档和恢复自定义角色。
- 活动角色和已归档角色都能被平台管理员找到，并有清楚的状态区分。
- 创建和编辑继续使用当前 permission 目录，不允许输入任意 permission 字符串。
- 保存 permission 变化前显示新增、移除项和该角色的分配用户数量。
- 归档前显示影响结果；存在用户分配时不能提交归档。
- 页面覆盖加载、空数据、查询失败、写入失败和权限被撤销后的状态。
- 没有 `authorization:manage` 的用户看不到写操作；API 仍独立执行 permission 和平台管理员检查。

### R6. 保持现有边界

- Better Auth session 继续只负责身份认证。
- 全局角色和 permission 继续由当前授权表及 `PermissionKeys` 决定。
- `admin` 继续自动获得全部活动且已注册 permission，其 permission 集合不可编辑。
- `operator` 和 `viewer` 的 permission 仍允许平台管理员通过现有接口调整。
- 新增 permission 仍通过 contracts、API guard、migration、默认角色设置和测试一起发布。

### R7. 规划与实施门禁

- 本任务属于跨 contracts、API 和 Admin 的复杂任务，需要 `design.md` 和 `implement.md`。
- 现有 `roles`、`role_permissions`、`user_roles`、授权审计表及索引已经支持本任务，不生成 migration。
- 未经最终规划评审和后续明确批准，不运行 `task.py start`，不修改 `apps/` 或 `packages/`。

## Out of Scope

- 用户账号停用、恢复、邀请、管理员创建用户、Session 撤销和用户物理删除。
- 角色物理删除、系统角色重命名、自定义角色继承和用户直授权限。
- permission 运行时创建、改名、删除、通配符和显式 deny。
- Organization、多租户角色、API Key、M2M、FGA、策略 DSL 或权限缓存。

## Acceptance Criteria

- [x] 用户明确选择自定义角色生命周期与影响分析。
- [x] 用户选择名称生成 key 建议值、创建前可修改、创建后不可变的交互。
- [x] 平台管理员可以创建自定义角色，并在同一 transaction 中保存初始 permission。
- [x] 自定义角色可以修改名称和描述，role key 始终不变。
- [x] 有用户关联的自定义角色不能归档；无关联角色可以归档和恢复。
- [x] 系统角色生命周期受保护，`admin` permission 继续不可编辑。
- [x] 角色和 permission 影响查询对活动关系给出正确结果，用户数量去重。
- [x] 创建、修改、归档和恢复的实际变化各写一条规定的审计事件，幂等操作不写事件。
- [x] Admin 覆盖创建、编辑、影响提示、归档、恢复以及加载和错误状态。
- [x] permission 仍由代码注册，管理端没有 permission CRUD。
- [x] `design.md`、`implement.md` 和 context manifests 已完成并通过任务校验。
- [x] 用户批准最终规划摘要后，才能进入实现。
