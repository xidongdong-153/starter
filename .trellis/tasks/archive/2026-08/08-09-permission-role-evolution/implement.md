# 执行计划

## 1. 当前规划任务

本任务只交付调研和路线设计，不修改 `apps/`、`packages/`、migration 或产品文档。

- [x] 读取归档任务 `explore-user-permissions`。
- [x] 审计当前 API、Admin、contracts、migration 和 tests。
- [x] 核验 Auth0 进阶授权能力及 Better Auth 1.6.16 扩展边界。
- [x] 用户确认脚手架默认采用通用单租户后台产品画像。
- [x] 完成 `prd.md`、`design.md` 和三份 `research/*.md`。
- [x] 完成 PRD 最终整理，去除重复事实和已解决问题。
- [x] 配置 `implement.jsonl` 和 `check.jsonl` 的真实 spec/research 上下文。
- [x] 运行任务文件 Format、Trellis validate 和 `git diff --check`。
- [x] 向用户提交最终规划摘要并获得明确批准。
- [x] 获得批准后运行 `task.py start`；本任务的执行阶段只做规划交付检查、规范判断和提交，不实现下列产品功能。

当前任务验证命令：

```bash
pnpm exec prettier --check .trellis/tasks/08-09-permission-role-evolution
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-09-permission-role-evolution
git diff --check
```

## 2. 后续任务结构

后续获得用户同意时，建议创建一个 `rbac-governance` 父任务，并按以下顺序创建、规划和验证子任务：

1. `authorization-governance-foundation`
2. `role-lifecycle`
3. 真实业务触发后再创建资源范围、Organization、机器身份或 FGA 任务

父任务只保存共同需求、任务顺序和最终集成验收，不直接承载产品代码。每个子任务分别完成 PRD、design、implement、migration、测试和提交。

## 3. 子任务一：授权治理基础

这是建议立即开始的下一项产品任务。

### 3.1 范围

- [ ] 把 `admin` 明确定义为平台根角色，并在所有 HTTP 授权写操作中增加 transaction 内平台管理员检查。
- [ ] 覆盖任意用户角色替换、任意角色 permission 替换、`admin` 授予和 `admin` 撤销，不把 `authorization:manage` 当成可委派边界。
- [ ] 保留现有 self-mutation 403，并在 repository transaction 内保护最后一个活动平台管理员。
- [ ] 新增 authorization 模块内的追加式审计表和索引。
- [ ] 为用户角色替换、角色 permission 替换、新用户默认角色和 `auth:bootstrap-admin` 的实际变化写一条审计事件。
- [ ] 增加 `authorization-audit:read` permission、分页查询 schema 和 DTO。
- [ ] 增加审计查询 route、service、repository、presenter 和 OpenAPI。
- [ ] Admin 增加审计列表、筛选、分页、加载、错误和空状态。
- [ ] 增加 Admin Vitest `test` script 和 node 环境配置，覆盖权限纯逻辑、导航、route guard 与 query 失效；不为这些纯逻辑测试先引入 DOM 测试依赖。
- [ ] 把根目录 `pnpm test` 改为同时执行 API 与 Admin 测试，避免新增测试游离在质量门禁之外。

### 3.2 数据和契约顺序

1. 在 `packages/contracts/src/index.ts` 增加 audit permission、查询 schema、按 action 判别的响应 DTO、`AUTH.LAST_PLATFORM_ADMIN` 和需要的 409 response 类型。
2. 在 `apps/api/src/modules/authorization/` 增加 audit schema 和事件 action 封闭类型；`actor_type` 至少区分 `user`、`system`，`request_id` 对 CLI/hook 可空。
3. 把 schema 汇总到 `apps/api/src/infra/db/schema/index.ts`，生成新的 Drizzle migration。
4. 为 `created_at`、actor、action、target 设计实际查询所需索引。
5. migration 只追加表和 permission seed，不修改已提交 migration；migration seed 与历史用户回填不伪造用户审计事件。

检查点：代码 permission 目录、数据库活动 permission 和 migration seed 一致；`admin` 自动获得新增 permission，其他角色不自动增加。

### 3.3 API 顺序

1. 让授权写 repository 接收 actor 和 request context；route 继续使用 `requireAuth` 与 `requirePermission` 尽早拒绝。
2. 在写 transaction 内重新查询 actor 的活动 `admin` 角色。普通角色即使拥有 `authorization:manage`，也不能替换用户角色或角色 permission。
3. 保留 service 的 self-mutation 403。目标用户从有 `admin` 变成无 `admin` 时，在同一 transaction 内统计活动平台管理员；最后一个时返回 `AUTH.LAST_PLATFORM_ADMIN` 409。
4. 先读取规范排序后的 before 值；before 与 after 相同则不删除重插关系、不写事件，按幂等成功返回。
5. 状态实际变化时，在同一 transaction 更新关系并追加恰好一条事件。用户角色替换根据 `admin` 成员关系变化选择 `platform_admin.granted`、`platform_admin.revoked` 或 `user_roles.replaced`。
6. 角色 permission 替换写 `role_permissions.replaced`；事件构造器按 action 选择字段，不序列化完整 user/session/database record。
7. Better Auth 新用户 hook 在现有 profile/默认 `operator` transaction 中追加 `user_roles.initialized`，使用 `system` actor。
8. `auth:bootstrap-admin` 在角色实际变化时使用 `system` actor 写一条事件；目标原本没有 `admin` 时用 `platform_admin.granted`，原本已有 `admin` 但角色集合变化时用 `user_roles.replaced`。
9. 增加审计分页查询，支持时间、actor、action 和 target 过滤，固定按 `created_at DESC, id DESC` 排序。
10. 在 API repository/presenter 边界统一解析 `before_json`、`after_json`，返回 contracts 的 action 判别联合；损坏 payload 返回 500，不能把原始字符串交给 Admin。
11. 为 401、403、404、409、500 增加稳定 error code 和 OpenAPI response。

检查点：平台管理员身份、最后一个管理员、before、关系写入和审计都在同一 transaction 中判断或提交；任一步失败时不产生部分结果。

### 3.4 Admin 顺序

1. 在 `apps/admin` 增加 catalog 中已有的 Vitest devDependency、`test` script 和 node 环境配置；先覆盖不依赖 DOM 的权限与路由逻辑。
2. 新增 authorization audit API adapter、query keys 和 query options。
3. 增加需要 `authorization-audit:read` 的 route record。
4. 页面使用现有 Admin 表格、筛选和分页模式，不把审计结果写入 Zustand 或 localStorage。
5. before/after 使用 contracts 的结构化判别联合展示，Admin 不自行解析数据库 JSON；长 permission key、用户 ID 和 request ID 可复制但不能撑破布局。
6. 权限加载失败走 ErrorBoundary 或明确重试；403 保持 session，不跳登录。
7. 为 permission 判断、导航过滤、route guard 和 401/403 query 行为增加自动化测试。
8. 根目录 `package.json` 的 `test` 改为 `turbo run test`，让 `pnpm test` 同时运行 API 与 Admin test script。

### 3.5 验证

严格按项目质量门禁顺序运行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

另外验证：

- 普通角色即使被授予 `authorization:manage`，也不能替换任何用户角色或修改任何角色 permission。
- 现有 self-mutation 继续返回 403；repository 直接测试最后一个活动平台管理员保护返回 `AUTH.LAST_PLATFORM_ADMIN` 409，关系和审计表都不变。
- 用户角色、角色 permission、默认角色初始化和 bootstrap 的每次实际变化各生成一条审计事件。
- 幂等无变化请求不重写关系，也不生成事件。
- 审计事件 actor、request ID、before/after 与最终关系一致；CLI/hook 的 request ID 为空而不是伪造值。
- 审计分页在相同 `created_at` 下仍按 `id` 稳定排序；损坏 JSON payload 返回 500，不在 Admin 组件中临时解析。
- 平台管理员检查、关系 mutation 或审计写入失败时都回滚；数据库异常返回 500，不伪装成 403。
- 审计页面在桌面和移动视口没有文本或控件重叠。

### 3.6 回滚点

- migration 生成后先检查 SQL，未确认前不执行开发数据库 migration。
- 如果事务审计设计不能覆盖现有 repository，同一任务内回到设计阶段，不改成请求成功后异步补写。
- 发布后需要回滚代码时保留追加式审计表；旧授权查询不会读取它。
- 不在回滚中删除已提交 migration 或审计历史。

## 4. 子任务二：自定义角色生命周期与影响分析

该任务依赖“授权治理基础”已经完成并可记录新 mutation。

### 4.1 范围

- [ ] 创建自定义角色，校验 key、名称、描述和初始 permission。
- [ ] 通过 metadata PATCH 修改名称和描述，通过现有 permission PUT 单独修改 permission 集合。
- [ ] 查询角色影响范围，至少返回活动用户分配数量。
- [ ] 查询 permission 影响范围，至少返回活动角色 key 和去重后的活动用户数量。
- [ ] 归档没有活动用户分配的自定义角色。
- [ ] 恢复自定义角色，不自动恢复历史用户关系。
- [ ] 保护 `admin`、`operator`、`viewer` 的 key 和生命周期。
- [ ] 保持 `operator`、`viewer` permission 可由平台管理员调整。
- [ ] Admin 使用 Drawer 和 Tree 完成创建、编辑、影响提示、归档和恢复。
- [ ] 所有写操作复用平台 admin transaction 检查和授权审计，不再创建第二套日志。

### 4.2 契约建议

```http
POST /api/authorization/roles
PATCH /api/authorization/roles/{roleKey}
PUT /api/authorization/roles/{roleKey}/permissions
POST /api/authorization/roles/{roleKey}/archive
POST /api/authorization/roles/{roleKey}/restore
GET /api/authorization/roles/{roleKey}/impact
GET /api/authorization/permissions/{permissionKey}/impact
```

- `POST` 创建角色及初始 permission，实际变化只写 `role.created`。
- `PATCH` 只修改名称和描述，写 `role.updated`。
- permission `PUT` 只替换 permission 集合，写 `role_permissions.replaced`。
- 不增加 `DELETE`，不增加 permission 创建接口。
- role key 创建后不可修改。
- duplicate key 和有活动用户时归档使用 `COMMON.CONFLICT` 或任务设计确认的同等稳定 409 code。
- 归档提交时在 transaction 内再次检查活动分配，不能信任预览结果。

### 4.3 验证

除完整质量门禁外，至少验证：

- 重复 key 返回稳定的 409 error code，关系和审计都不变。
- 系统角色不能归档，`admin` permission 不能修改。
- 有活动分配的自定义角色不能归档。
- 归档角色不参与 `/api/me/permissions` 和 `requirePermission`。
- 恢复角色后 permission 仍按归档前关系生效，但用户关系不自动增加。
- role/permission impact 对多角色重叠用户去重，并与数据库实际关系一致。
- 创建、metadata 更新、permission 替换、归档和恢复各自只产生规定的一条事件。
- Admin 创建、编辑、影响查询、归档和恢复状态都有自动化测试或浏览器验收记录。

### 4.4 回滚点

- 角色表当前已经支持自定义角色和 `archivedAt`，优先复用现有字段，不为生命周期再建平行角色表。
- 接口代码回滚后，旧授权查询仍能识别已创建的活动自定义角色。
- 回滚归档功能前，先恢复仍需使用的角色；不物理删除角色或关系历史。

## 5. 条件任务：资源范围和策略

满足以下任一条件后再创建任务：

- 同一动作需要区分 own、department、all 等资源范围。
- 两个以上业务模块重复实现相同资源条件。
- 需要允许管理员跨用户访问资源，同时保持普通用户 owner 边界。

任务顺序：

1. 记录具体业务规则和资源字段。
2. 增加精确 elevated permission，例如 `file:read-any`。
3. 在业务 service 中组合动作 permission 与资源条件。
4. 两个以上模块出现相同形状后，再提取 TypeScript policy 接口。
5. 为允许、拒绝、资源隐藏和越权枚举增加测试。

验收时证明 elevated permission 只影响指定资源与动作，普通 permission 仍受 owner 条件限制，隐藏资源保持 404。回滚时先停止 route 使用新增 permission，再归档数据库目录记录；资源 owner 条件不得随 elevated 路径一起删除。

没有这些条件时，不创建 `policies` 表、策略 DSL、显式 deny、通配符或外部 PDP。

## 6. 条件任务：Organization

只有产品转为多租户 SaaS 时创建。该任务必须先完成独立设计，不与角色生命周期合并。

- [ ] 统一 Better Auth runtime、CLI 和 Organization plugin 版本。
- [ ] 让 Better Auth Organization plugin 成为 organization、member、invitation 和组织角色的唯一事实来源。
- [ ] 给所有租户资源增加非空 organization ID，并先完成数据迁移。
- [ ] 当前全局 RBAC 只保留平台角色。
- [ ] API 同时校验目标资源 organization、membership 和组织 permission。
- [ ] 平台 `admin` 跨组织操作使用显式分支和审计。
- [ ] 组织切换不把 `activeOrganizationId` 当作资源归属证明。
- [ ] 验证跨组织 API、后台任务和文件读取均拒绝，平台跨组织操作有显式审计。

进入实现前必须给出旧用户、旧文件、旧角色和旧 session 的迁移及回滚步骤。回滚必须说明已经写入 organization ID 的资源如何恢复到单租户读取，不能只卸载 plugin 或删除 session 字段。

## 7. 条件任务：API Key 和 M2M

出现外部自动化、CLI、第三方集成或服务间调用后再创建。

- API Key 和 OAuth client 使用独立 principal 与 grant。
- 不写入 `user_roles`，不启用 API key session 模拟。
- 明确权限是签发快照还是每次与当前授权求交集。
- 覆盖 secret 一次展示、安全摘要、轮换、过期、撤销和日志脱敏。
- M2M 先解决 Better Auth provider 版本，再实现 client credentials。
- 验证 key 的一次展示、安全摘要、轮换、过期、撤销、日志脱敏和最小权限；机器主体不能进入只接受用户主体的路径。
- 回滚先停止签发并撤销 client/key grant，再等待或主动处理已签发 token 的有效期；不能只删除管理页面。

## 8. 条件任务：FGA

只有对象关系授权成为主要需求时创建独立研究任务。开始实现前必须证明 TypeScript 资源策略已经难以维护，并完成以下设计：

- authorization model 与版本。
- tuple 写入和删除的唯一入口。
- 业务事务与 tuple 同步失败处理。
- Check/List API 延迟、超时和 fail-closed 行为。
- 一致性要求、数据迁移和 provider 回滚。
- 验证 tuple 写入失败、模型版本迁移、业务数据对账和 provider 不可用时不会放行。

不在当前仓库提前增加 FGA client、tuple 表或 provider 抽象。回滚设计必须先停止新 tuple 写入，并说明业务授权回到哪一个本地事实来源；不能在仍依赖 FGA 关系时直接关闭 provider。

## 9. 每个后续任务的共同检查

- 先读取 `.trellis/spec/api/backend/authorization-guidelines.md` 和 `.trellis/spec/admin/frontend/authorization-guidelines.md`。
- contracts 先改，API 与 Admin 随后同步，不能在客户端复制 DTO。
- 每个新增受保护 endpoint 都有状态码、error code、OpenAPI response 和 API smoke test。
- 前端隐藏入口不能替代 API guard。
- RBAC permission 不能替代资源 owner 或 organization 条件。
- 授权撤销在下一次受保护 API 请求生效。
- 只清理本次任务产生的无用代码，不借权限任务重构用户、文件或认证模块。
