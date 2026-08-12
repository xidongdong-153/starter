# PRD：权限矩阵测试（BOLA/BFLA 表驱动测试）

## 背景

脚手架已实现全局 RBAC（roles / permissions / user_roles / role_permissions）、
`requirePermission` 中间件、角色生命周期与影响分析、授权审计、平台管理员写入边界、
NIST SSD 职责分离（admin 独占角色）。授权规范见
`.trellis/spec/api/backend/authorization-guidelines.md`。

现有 smoke tests（`apps/api/src/test/`）按功能点分散覆盖授权行为，但没有一张
「角色集合 × 资源 × 动作 → 期望结果」的表驱动矩阵，两类典型授权缺陷缺少系统性回归：

- BFLA（功能级授权缺失）：拥有 file 功能权限，但目标资源不属于当前用户。
- BOLA（对象级授权缺失）：不同用户之间资源越权访问。

## 目标

在 `apps/api/src/test/` 新增表驱动权限矩阵测试，系统覆盖：

1. files 模块 owner 检查（fileId + currentUserId 归属判断）：read / rename / delete。
2. profile 模块头像 owner 检查：`PUT /api/profile/avatar` 使用他人 fileId。
3. authorization 控制面接口的权限矩阵（读 / 写 / 审计）。

## 范围

- 仅新增/扩展 `apps/api/src/test/` 下的测试文件。
- 不修改产品代码，不新增 migration，不改 contracts。
- 复用现有测试基建：`createTestApp`、`register`、`readSuccess`、`readFailure`、
  `grantPermissionToRole`（如需要可复制到新文件，不依赖跨文件私有函数）。

## 验收标准

1. 表驱动：用例以「角色集合 × 动作 × 资源归属 → 期望状态码」表格形式定义，
   同一驱动函数执行全部用例（`it.each` 或循环，逐用例可定位）。
2. BFLA：拥有 `file:delete` 等功能的用户删除/重命名/读取他人文件返回 404
   （`COMMON.NOT_FOUND`），不返回 200。
3. BOLA：两个普通用户（都有 file 权限）不能互相读取、重命名、删除对方文件；
   不能把对方文件设为自己的头像（`PUT /api/profile/avatar` 返回 404）。
4. 控制面矩阵：admin 可执行授权写操作；持有 `authorization:manage` 的非 admin
   写操作被拒绝（403 `AUTH.FORBIDDEN`）、读操作放行；匿名请求 401。
5. admin 特权语义：admin 自动拥有全部已注册权限的分支在矩阵中显式体现
   （独立用例：删除 admin 的 role_permissions 行后权限与访问能力不变）。
6. 断言同时验证「响应状态码/错误码」和「资源未被修改」：被拒绝的删除后文件仍存在、
   被拒绝的重命名后文件名不变、被拒绝的头像设置后 avatar 未变。
7. 全量门禁通过：`pnpm check`（types → lint → format，零错误）+ `pnpm test` 全绿。

## 非目标

- 不改变任何鉴权、owner 检查或资源边界行为（纯测试任务）。
- 不覆盖 upload 的文件类型/大小校验、分页、审计分页等与权限矩阵无关的行为
  （已有 smoke tests 覆盖）。
