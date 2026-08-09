# Auth0 进阶授权能力调研

核验日期：2026-08-09。

本文只使用 Auth0、Auth0 FGA 和 OpenFGA 官方资料。范围限于 Core RBAC、Organizations、Organization roles、Management API、Actions、Auth0 FGA、租户日志以及 M2M/API access control。这里不复核当前仓库源码，供后续 `design.md` 和 `implement.md` 结合本地实现使用。

## 结论

Auth0 的授权能力不是一个统一角色表，而是几组边界不同的产品能力：

1. Core RBAC 管理 API permission、tenant role、用户角色和用户直授权限，适合粗粒度、全局、加法式授权。
2. Organizations 为 B2B 多租户提供组织上下文、成员、连接和组织范围授权。已有的“给 Organization member 分配 tenant role”是 GA；“每个 Organization 自己定义 role”仍是 Early Access，不能把两者当成同一能力。
3. Actions 是 token 签发流程中的同步扩展点，可以拒绝请求、增加 claim 或修改 scope。它不是持久化策略系统，修改 scope 还会覆盖 Core RBAC 的 scope 结果。
4. Auth0 FGA 是独立的托管授权产品，有自己的账号、store、模型、tuple、API 凭据和运行时检查。它基于 CNCF 的 OpenFGA，但不属于 Core RBAC 或 Organizations 的自动升级路径。
5. Auth0 tenant logs 能记录认证事件和 Auth0 配置变更，适合控制面审计和外部 SIEM。它不能记录脚手架自己数据库里的角色或权限变更，因此不能替代应用审计表。
6. M2M/API access control 以 application、API、client grant 和 scope 为事实来源；没有用户角色。Organization M2M 再增加 `org_id` 和 client grant 与 Organization 的关联。

对当前通用 TypeScript 脚手架，最值得近期借鉴的是稳定 Core RBAC 的约束：权限目录、角色权限并集、最小权限、服务端授权、明确的角色变更接口和应用审计。Organizations、M2M、Actions/FGA 都应由业务触发，不应作为默认基础设施一起引入。

## 能力分类与取舍

| 能力 | Auth0 产品归属与状态 | 官方行为 | 对脚手架的判断 | 进入条件 | 主要代价 |
| --- | --- | --- | --- | --- | --- |
| Core RBAC | Auth0 Authorization Core，GA | permission 定义在 API 上；role 收集 permission；用户可有多个 role，有效 permission 取并集 | **近期默认能力**。借鉴模型和最小权限原则，不需要复制 Auth0 token 控制面 | 当前权限标识、角色赋权和服务端检查需要稳定 | 权限重命名、角色变更兼容、审计和测试成本 |
| 用户直授权限 | Core RBAC 原生支持 | Dashboard/Management API 可直接给用户增加或删除 permission | **脚手架不内置**。会产生“角色权限 + 用户例外”两个事实来源 | 只有明确存在少量、可审计、带期限的例外授权时再单独设计 | 权限解释、回收、审计和 UI 复杂度明显增加 |
| Organizations | Auth0 Organizations，套餐相关 | 一个 Auth0 tenant 内表示多个 B2B 客户，管理成员、连接、品牌和组织上下文 | **条件成熟后增加**，不作为通用单租户模板默认值 | 产品确定为多租户 SaaS，资源表已有不可绕过的 tenant/org 边界 | 数据迁移、所有查询的租户隔离、登录上下文和测试范围 |
| Organization member role | Organizations，分配接口 GA | 同一用户可在不同 Organization 中有不同角色；每次调用只处理一个 Organization | **条件成熟后增加** | 已有 Organization membership，且同一用户确实需要跨组织不同权限 | 角色来源冲突、组织切换、token/请求上下文校验 |
| Organization-local role definition | Organization Roles，Early Access | role 定义本身只存在于某个 Organization；每个 Organization 上限 350 个 | **当前不作为默认设计依据** | 客户必须自定义角色，且产品愿意承担 EA 变化和角色数量膨胀 | 数据模型、管理 UI、模板同步、升级兼容和产品可用性风险 |
| Management API role assignment | Auth0 Management API，GA | 全局用户角色与 Organization member 角色使用不同 endpoint 和 scope；role 必须先存在 | **借鉴接口边界，不复制 Management API** | 需要后台或自动化管理角色 | 幂等、并发、鉴权、审计、批量限制和限流 |
| Post Login Actions | Auth0 Actions | 同步执行；可拒绝登录、读取登录上下文、写自定义 claim、增加或删除 access token scope | **条件成熟后增加**，优先在服务端请求时做上下文授权 | 决策必须发生在 token 签发时，且 token 生命周期内结果可接受 | 登录延迟、失败影响认证、策略散落、token 陈旧 |
| Credentials Exchange Actions | Auth0 Actions | 在 Client Credentials token 签发前同步执行，可拒绝交换或增加 claim | **M2M 模块的可选扩展** | 已有 M2M client grant，且仅靠静态 scope 不够 | token 签发可用性和外部依赖延迟 |
| Client grants / API access policy | Auth0 API access control | application + audience + allowed permissions 构成 grant；可要求必须存在 grant；对 user-delegated flow 还是权限上限 | **M2M 或第三方应用场景再增加** | 服务间调用、客户 API key/client、第三方应用接入 | client secret 生命周期、grant 管理、scope 版本和撤销延迟 |
| Organization M2M | Organizations，指定套餐 | Client Credentials token 带 `org_id`；第三方应用必须按 Organization 显式授权；API 必须按 `org_id` 隔离数据 | **多租户 M2M 的后续模块** | Organizations 和 M2M 都已成立 | 多维 grant、跨租户风险、旧 token 继续有效、套餐约束 |
| Auth0 FGA | 独立 Auth0 FGA 托管产品 | authorization model + relationship tuple + Check/List API，支持 ReBAC，并可通过 condition 表达部分 ABAC | **脚手架不内置，保留 provider 边界即可** | 出现大量对象级共享、父子继承、协作者关系，RBAC 无法稳定表达 | 独立数据面、tuple 同步、一致性、网络调用、模型版本和运维 |
| Auth0 tenant logs / log streams | Auth0 tenant 控制面 | 记录认证和配置变更；短期保留；可拉取或至少一次投递到外部系统 | **借鉴审计原则**。本地角色权限变更先写应用审计；外部 stream 延后 | 有合规保留、取证、告警或跨系统汇总要求 | PII、去重、乱序、长期存储、查询和访问控制 |
| Dashboard tenant member roles | Auth0 控制面角色 | 限制谁能修改 Auth0 tenant 配置，与业务 API role 分开 | **借鉴边界，不复制角色列表** | 脚手架需要平台运维人员和业务管理员分权 | 平台管理员绕过路径、紧急访问和操作审计 |

## 1. Core RBAC

### 1.1 官方模型

[Role-Based Access Control](https://auth0.com/docs/manage-users/access-control/rbac) 给出的模型是：

- permission 表示对某个 Auth0 API resource server 的操作能力。
- role 是 permission 集合，可以同时收集多个 API 的 permission。
- 用户可以分配一个或多个 role。
- 多个 role 重叠时使用加法模型，有效 permission 是各 role permission 的并集。
- 官方建议按最小权限分配。

Core RBAC 不只有角色赋权。[Manage Role-Based Access Control Users](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/rbac-users) 明确列出用户角色管理和用户直授权限管理。因此，“只允许 User -> Role -> Permission”是脚手架可以主动选择的简化边界，不是 Auth0 Core RBAC 的限制。

官方模型只描述 role 收集 permission 和多角色并集，没有给 Core RBAC 定义角色继承或显式 deny 语义。路线设计可以借鉴它的加法式模型，但不应把“Auth0 没有能力”作为不做继承的唯一理由；脚手架不做继承的直接理由应是保持一个可解释的权限来源。

### 1.2 access token 行为

[Enable Role-Based Access Control for APIs](https://auth0.com/docs/get-started/apis/enable-role-based-access-control-for-apis) 说明：

- 开启 RBAC 后，access token 的 `scope` 是“客户端请求的 permission”和“用户已分配 permission”的交集。
- 关闭 RBAC 时，应用可以请求该 API 定义的任意 permission，`scope` 会包含所有请求项。
- 开启 `Add Permissions in the Access Token` 后，token 增加 `permissions` claim，内容是用户所有已分配 permission，不只限于本次请求的交集；代价是 token 变大。
- token dialect 会在 `access_token` / `access_token_authz` 或 `rfc9068_profile` / `rfc9068_profile_authz` 之间切换。
- Actions 修改 access token scope 时，会覆盖 RBAC 设置的 scope。

这套行为适合集中式授权服务器。当前脚手架若继续以服务端数据库为授权依据，不必模仿 `permissions` claim；更重要的是保留同样清楚的规则：请求权限不能扩大主体在服务端已拥有的权限，前端拿到的权限只用于界面显示。

### 1.3 推荐边界

近期默认采用：

- permission 使用稳定、可枚举的操作标识。
- role 只收集 permission，不继承其他 role。
- 用户有效 permission 只取 role permission 并集。
- 不支持显式 deny、通配符和用户直授权限。
- 角色和 permission 变更写应用审计记录。

进入用户直授权限阶段的条件：已经出现无法通过小数量稳定角色表达的临时例外，并且例外必须有申请人、批准人、原因、有效期和自动回收。缺少这些字段时，直授权限只会把角色模型变成不可解释的例外集合。

## 2. Organizations 与角色边界

### 2.1 Organizations 解决什么问题

[Auth0 Organizations](https://auth0.com/docs/manage-users/organizations) 的目标是让一个 Auth0 tenant 表示多个 B2B 客户或合作方，并分别管理：

- Organization membership；
- 每个客户的 federated login 和 branding；
- Organization 范围的角色；
- 客户或合作方的 M2M API access；
- 基于 Organizations API 的客户自助管理。

该能力受 Auth0 套餐和登录实现限制。它是身份与登录控制面的一部分，不自动完成业务数据库的数据隔离。

[Work with Tokens and Organizations](https://auth0.com/docs/manage-users/organizations/using-tokens) 要求 API 收到带 `org_id` 的 access token 后：

- 校验 `iss`；
- 校验 `org_id` 是应用预期、已知、可信的 Organization；
- 如果启用 `org_name`，还要校验 `org_name`；
- 所有数据和资源访问都按 `org_id` 分段。

因此，Organizations 的进入条件不应只是“需要组织表”。必须先确认所有租户资源都能可靠绑定 `organization_id`，所有查询都强制带组织范围，后台任务和文件存储也不会绕过该范围。

### 2.2 三种容易混淆的角色关系

后续设计应把下列事实来源分开命名：

1. **tenant role definition**：定义在 Auth0 tenant，permission 可来自多个 API。
2. **tenant-level user role assignment**：通过 `/api/v2/users/{id}/roles` 给用户分配，作用于整个 tenant 上下文。
3. **organization member role assignment**：通过 `/api/v2/organizations/{id}/members/{user_id}/roles` 分配，只影响指定 Organization。

Organization member assignment 又能引用两类 role definition：

- tenant role：定义全局，但分配可限定到某个 Organization member 上下文；
- Organization role：role definition 本身只存在于某个 Organization。

[Organization Roles](https://auth0.com/docs/manage-users/organizations/organization-roles) 把后者标为 Early Access，并给出两层模型：tenant roles 与 Organization roles。用户通过 Organization 登录时，token 可以包含在该 Organization 中分配的 tenant role、Organization role 或两者的 permission；没有 Organization 上下文时，只有 tenant role 生效。Organization role 使用与 tenant role 相同的 API permission 模型，每个 Organization 最多 350 个 Organization role。

[Add Roles to Organization Members](https://auth0.com/docs/manage-users/organizations/configure-organizations/add-member-roles) 还说明每个 Organization member 最多分配 50 个 role，所需 Management API scope 为 `create:organization_member_roles`。

路线设计不能只放一个 `user_roles` 表再加可空 `organization_id`，否则全局角色、组织内分配和组织私有角色会共享不清楚的唯一约束与管理入口。更稳的顺序是：

1. 先保留全局 role definition 和全局 user-role assignment。
2. 确定多租户后，增加 organization membership 和独立的 organization-member-to-role assignment；第一版仍复用全局 role definition。
3. 只有客户必须自定义角色时，再增加 organization-local role definition。不要因为 Auth0 有 EA 功能就提前加入。

### 2.3 平台管理员

[Dashboard Access by Role](https://auth0.com/docs/get-started/manage-dashboard-access/feature-access-by-role) 展示了 Auth0 对控制面角色的处理：tenant member role 限制谁能编辑 Auth0 配置，和业务 API role 分开。比如 `Editor - Organizations`、`Editor - Users` 与 `Admin` 权限不同。

脚手架应借鉴这个边界：平台级管理员是系统控制面身份，不是某个 Organization role，也不应通过给每个组织重复分配管理员角色实现。若平台管理员允许跨租户操作，必须使用单独的显式检查和审计事件；普通 Organization 管理员不能通过组织角色获得平台能力。

## 3. Management API 与角色分配

Auth0 用不同 endpoint 表达不同范围：

- [Assign roles to a user](https://auth0.com/docs/api/management/v2/users/post-user-roles)：`POST /api/v2/users/{id}/roles`，GA，给用户分配 tenant 范围角色；不能在该调用中创建 role。endpoint 文档列出 `update:users` 或 `create:role_members` scope。
- [Assign user roles to an Organization member](https://auth0.com/docs/api/management/v2/organizations/post-organization-member-roles)：`POST /api/v2/organizations/{id}/members/{user_id}/roles`，GA，只处理一个 Organization，不能一次跨多个 Organization，scope 为 `create:organization_member_roles`。

[Assign Roles to Users](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/rbac-users/assign-roles-to-users) 还指出 Dashboard 角色选择器超过 50 个 role 时只显示前 50 个，其他 role 需要通过 Management API 分配。这说明“系统支持数量”和“管理界面可操作数量”应分开验收。

[Management API Access Tokens](https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens) 的安全约束包括：

- Management API token 必须使用正确 audience 和 endpoint scope。
- 默认有效期 24 小时，可按 API 调整。
- access token 签发后不能撤销，应使用满足场景的最短有效期。
- token quota 和 Management API rate limit 受套餐约束。

脚手架不需要复刻 Management API。应借鉴的只有接口边界和权限边界：

- 创建 role、修改 role permission、给用户分配全局 role、给 Organization member 分配组织上下文 role 使用不同命令和权限。
- 角色必须先创建，assignment endpoint 不接受内联 role definition。
- 写操作返回前完成事务，并写 actor、target、before、after、reason、request/correlation ID。
- 批量接口明确单次上限、部分失败语义和幂等方式。

## 4. Actions 扩展 token

### 4.1 Post Login

[Post Login Actions](https://auth0.com/docs/customize/actions/explore-triggers/post-login) 在用户成功认证后、token 签发前同步运行，也会在 refresh token exchange 时运行。它可以：

- 根据用户、应用、API、时间、IP、地理位置等上下文调用 `api.access.deny(...)`；
- 从 `event.authorization.roles` 读取角色，并用 `api.idToken.setCustomClaim(...)` 或 `api.accessToken.setCustomClaim(...)` 写入 namespaced claim；
- 用 [Post Login API Object](https://auth0.com/docs/customize/actions/reference/post-login/post-login-api-object) 提供的 `api.accessToken.addScope(...)` 和 `api.accessToken.removeScope(...)` 增加或删除 scope；
- 修改用户 metadata 或触发 MFA。

官方明确说明该 flow 是 blocking/synchronous。Actions 的执行时间和失败会直接影响登录流程。[Sample Use Cases: Actions with Authorization](https://auth0.com/docs/manage-users/access-control/sample-use-cases-actions-with-authorization) 将它定义为对预配置授权策略结果的修改或补充，而不是角色和 permission 的持久化来源。

适用条件：

- 决策所需上下文只在登录或 token exchange 时可靠存在；
- 授权结果允许在 token 有效期内保持不变；
- Action 依赖失败时有明确的 fail-closed 行为；
- 所有增加 scope 的逻辑先固定校验目标 audience，不读取不可信输入直接扩权。

不适用情况：

- 每次资源访问都需要读取对象状态、所有者或成员关系；
- 撤权必须立即生效；
- 规则需要业务人员频繁编辑、版本化和解释；
- 计划把数据库授权判断整体搬进 token。

对于当前脚手架，上下文授权优先放在 API 请求路径，输入为已认证主体、目标资源和当前请求上下文。只有未来接入外部身份提供方且必须在其 token 中携带 claim 时，才把薄的 claim enrichment 放到 Actions 等价层。

### 4.2 Credentials Exchange

[Credentials Exchange Actions](https://auth0.com/docs/customize/actions/explore-triggers/credentials-exchange) 在 Client Credentials access token 签发前同步运行，可拒绝 token exchange 或写 namespaced custom claim。它适合给 M2M token 增加由可信服务计算的上下文，不能替代 client grant 本身。

## 5. M2M 与 API access control

### 5.1 client grant

[Application Access to APIs: Client Grants](https://auth0.com/docs/get-started/applications/application-access-to-apis-client-grants) 将 client grant 定义为：

- 一个 API `audience`；
- 一个 application `client_id`；
- 该 application 对该 API 最多可申请的 `scopes` 或授权详情类型；
- `subject_type=client` 表示 M2M，`subject_type=user` 表示代用户访问。

同一 application 对同一 API 最多可以有两个 grant，分别对应 `client` 和 `user`。对 user-delegated flow，最终 permission 是以下集合的交集：

- application 请求的 permission；
- client grant 允许的 permission；
- 用户 RBAC 允许的 permission；
- 用户同意的 permission，如果该 flow 需要 consent。

`require_client_grant` 让只有存在 grant 的 application 才能获得该 API token，官方按最小权限原则推荐此设置。`allow_all_scopes=true` 会自动允许未来新增的 scope，通用脚手架不应默认提供等价选项。

M2M 没有用户角色，授权主体是 application/client。只有出现以下需求时才值得新增模块：

- 后端服务用独立身份调用 API；
- 客户要创建 bot、CLI 或自动化集成；
- 第三方 application 需要受限 API access；
- 需要独立撤销某个 client 对某个 API 的权限。

数据模型至少要把 human principal 与 service principal 分开，不能把 M2M client 伪装成用户再套用 `user_roles`。

### 5.2 Organization M2M

[Machine-to-Machine Access for Organizations](https://auth0.com/docs/manage-users/organizations/organizations-for-m2m-applications) 只在 B2B Professional、Enterprise 和 Enterprise premium 等指定套餐提供。它要求：

- Client Credentials 请求带 Organization 上下文；
- token 包含 `org_id`；
- API 校验 `org_id` 并按它隔离资源；
- 第三方 application 不能使用 `allow_any_organization`，每个 Organization 都必须显式建立 `organization_client_grant`；
- 可信内部 application 才可选择访问任意 Organization。

[Configure M2M Access with Auth0 Organizations](https://auth0.com/docs/manage-users/organizations/organizations-for-m2m-applications/manage-m2m-access) 说明，撤销 Organization 与 client grant 的关联后，只阻止申请新 token；已经签发的 token 仍需等到过期。查询哪些 application 可访问 Organization 还是 eventually consistent。

所以 Organization M2M 必须晚于普通 Organizations 和普通 M2M：先证明租户隔离，再引入 service principal，再组合两者。不可把它作为“一次实现多租户和开放 API”的捷径。

## 6. Auth0 FGA 与 OpenFGA

### 6.1 产品关系

[Auth0 FGA Getting Started](https://docs.fga.dev/getting-started) 明确写明：

- Auth0 FGA 是面向开发者的可扩展授权服务。
- 它受 Google Zanzibar 启发，以 ReBAC 为主，可以表达 RBAC，并提供实现部分 ABAC 的能力。
- Auth0 FGA 基于 OpenFGA；OpenFGA 是 CNCF 所有的开源项目，Auth0/Okta 是核心维护者。

Auth0 FGA 是独立托管产品，而不是 Auth0 tenant 内 Core RBAC 的一个开关。官方入门流程要求单独：

- 创建 FGA account；
- 选择 authorization data 的 jurisdiction；
- 创建 store；
- 编写和版本化 authorization model；
- 写 relationship tuples；
- 创建 FGA API client credentials；
- 调用区域 API，例如 `https://api.us1.fga.dev/stores/{store_id}/check`。

身份认证可以继续由 Auth0、Better Auth 或其他系统完成；应用需要把稳定主体 ID 映射到 FGA tuple，并在业务 API 中主动调用 Check/List API。Core RBAC role、Organization membership 不会自动同步成 FGA tuple。

### 6.2 适合解决的问题

[OpenFGA Concepts](https://openfga.dev/docs/concepts) 定义的核心元素是 type、object、relation、authorization model 和 `(user, relation, object)` relationship tuple。Check 请求判断某个主体是否与对象存在指定关系，关系可以是直接或通过对象关系推导得到。

[Managing Relationships Between Objects](https://docs.fga.dev/writing-data/managing-relationships-between-objects) 的官方示例展示了 Organization 拥有 repository、用户是 Organization 的 `repo_admin`，从而推导用户对所有该 Organization repository 的 `admin` 关系。删除一条对象关系 tuple 即可撤销整条推导路径。

这类模型适合：

- 文档、项目、目录等对象级 owner/editor/viewer；
- 团队成员继承父级对象权限；
- 跨组织共享单个资源；
- “用户通过某个组或对象关系获得权限”；
- 需要 ListObjects/ListUsers 一类授权反查。

OpenFGA condition 使用 CEL，根据参数计算布尔结果，可表达时间、区域等条件。但它会引入模型版本、tuple 生命周期、业务数据与授权数据同步、网络检查延迟、一致性和故障处理。只有当对象关系成为主要授权需求且关系数量已经无法由简单资源范围字段解释时，才应单独评估。

脚手架当前不应内置 Auth0 FGA/OpenFGA，也不应提前设计通用策略 DSL。最多在授权 service 边界保留“给定主体、动作、资源、上下文返回 allow/deny”的稳定调用形状，未来是否接外部 FGA 由独立任务决定。

## 7. 日志与授权治理

### 7.1 Auth0 原生记录范围

[Logs](https://auth0.com/docs/deploy-monitor/logs) 说明 Auth0 tenant logs 记录认证事件和配置变更，可用于：

- 查看 tenant administrator 操作；
- 查看 Management API 操作；
- 查看用户认证、错误和攻击检测事件；
- 通过 `X-Correlation-ID` 关联 Management API 请求；
- 导出到 SIEM 或分析系统。

[Tenant log `sapi`](https://auth0.com/docs/tenant-logs/management-success/sapi) 是 Management API 的成功写操作事件，只在 `POST`、`DELETE`、`PATCH`、`PUT` 时产生。schema 可包含 request/response details、IP、client ID、user ID、时间和 correlation/trace ID。这能支持“谁通过 Auth0 控制面做了什么”的追查。

但它只覆盖 Auth0 tenant 和 Auth0 Management API。当前脚手架直接修改本地数据库的角色、permission、用户状态或 Organization membership，不会进入 Auth0 tenant logs。应用必须拥有自己的授权变更审计事实来源。

建议应用审计最少记录：

- `actor_type`、`actor_id`；
- `action`；
- `target_type`、`target_id`；
- `scope_type`、`scope_id`，例如 global 或 organization；
- 变更前后结构化值；
- 原因或工单标识；
- request/correlation ID、IP、user agent；
- 服务端生成的时间；
- 成功或失败结果。

授权 mutation 与审计写入应在同一数据库事务内完成，避免角色已变更但没有审计事件。审计查询权限应与角色编辑权限分开。

### 7.2 保留与流式导出限制

[Log Data Retention](https://auth0.com/docs/deploy-monitor/logs/log-data-retention) 当前列出的保留期按套餐为 1、5、10 或 30 天，并明确 tenant logs 不是实时日志，索引可能延迟。

[Log Streams](https://auth0.com/docs/customize/log-streams) 提供接近实时的外部导出，但官方限制包括：

- 不建议放在应用关键路径或用于实时授权判断；
- 日志可能乱序；
- 至少一次投递，接收端需要去重；
- 连续投递失败 7 天后 stream 会暂停；
- 可筛选日志类别，并对部分 PII 做 mask 或 xxHash。

因此，治理路线应分层：

1. 近期默认：应用数据库内记录授权写操作审计，提供按主体、目标和时间查询。
2. 有合规需求后：设置不可由普通业务管理员修改的保留期和导出任务。
3. 有 SIEM/告警需求后：增加外部 stream，按 event ID 去重并自行排序。
4. 不使用异步日志 stream 作授权决策，也不依赖它即时撤权。

## 8. 对后续设计的明确边界

### 8.1 近期默认能力

- 全局 permission catalog。
- 全局 role definition。
- 用户与全局 role 的多对多分配。
- 有效 permission 为 role permission 并集。
- API 服务端读取权威数据并执行授权；Admin permission 只用于界面。
- 角色、permission、用户角色变更的应用审计。
- 平台级管理员与业务 role 分开检查。

### 8.2 条件成熟后增加

- 资源范围或条件授权：先用明确字段和服务端 predicate，不先建 DSL。
- Organization membership 和 Organization member role assignment：仅在产品确认多租户后。
- Organization-local role definition：仅在客户自定义角色成为需求后，并参考 Auth0 EA 能力时保留变更余地。
- M2M client 和 API grant：仅在服务账号或第三方 API 接入出现后。
- Organization M2M：仅在 Organizations 与 M2M 都稳定后。
- 外部日志导出：仅在保留、告警或 SIEM 要求出现后。
- Auth0 FGA/OpenFGA：仅在对象关系授权成为主要问题后单独评估。

### 8.3 脚手架不内置

- Auth0 Dashboard、Management API 或 tenant member role 列表的复制品。
- 用户直授权限作为常规管理入口。
- 角色继承、显式 deny、通配符 permission。
- Organization-local role 作为默认角色模型。
- token 中携带全部业务授权事实。
- 通用策略 DSL、Redis 权限缓存或外部 PDP/FGA 服务。
- 把 human user、M2M client、Organization role、platform admin 合并到同一角色事实来源。

## 官方来源索引

### Core RBAC 与 Management API

- [Role-Based Access Control](https://auth0.com/docs/manage-users/access-control/rbac)
- [Configure Core Authorization Features for RBAC](https://auth0.com/docs/manage-users/access-control/configure-core-rbac)
- [Enable RBAC for APIs](https://auth0.com/docs/get-started/apis/enable-role-based-access-control-for-apis)
- [Manage RBAC Users](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/rbac-users)
- [Assign Roles to Users](https://auth0.com/docs/manage-users/access-control/configure-core-rbac/rbac-users/assign-roles-to-users)
- [Assign roles to a user endpoint](https://auth0.com/docs/api/management/v2/users/post-user-roles)
- [Assign roles to an Organization member endpoint](https://auth0.com/docs/api/management/v2/organizations/post-organization-member-roles)
- [Management API Access Tokens](https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens)

### Organizations 与 M2M

- [Auth0 Organizations](https://auth0.com/docs/manage-users/organizations)
- [Organization Roles](https://auth0.com/docs/manage-users/organizations/organization-roles)
- [Add Roles to Organization Members](https://auth0.com/docs/manage-users/organizations/configure-organizations/add-member-roles)
- [Work with Tokens and Organizations](https://auth0.com/docs/manage-users/organizations/using-tokens)
- [Application Access to APIs: Client Grants](https://auth0.com/docs/get-started/applications/application-access-to-apis-client-grants)
- [Machine-to-Machine Access for Organizations](https://auth0.com/docs/manage-users/organizations/organizations-for-m2m-applications)
- [Configure Your Application for M2M Access](https://auth0.com/docs/manage-users/organizations/organizations-for-m2m-applications/configure-your-application-for-m2m-access)
- [Configure M2M Access with Organizations](https://auth0.com/docs/manage-users/organizations/organizations-for-m2m-applications/manage-m2m-access)

### Actions 与 FGA

- [Post Login Actions](https://auth0.com/docs/customize/actions/explore-triggers/post-login)
- [Post Login API Object](https://auth0.com/docs/customize/actions/reference/post-login/post-login-api-object)
- [Sample Use Cases: Actions with Authorization](https://auth0.com/docs/manage-users/access-control/sample-use-cases-actions-with-authorization)
- [Credentials Exchange Actions](https://auth0.com/docs/customize/actions/explore-triggers/credentials-exchange)
- [Auth0 FGA Getting Started](https://docs.fga.dev/getting-started)
- [Auth0 FGA: Managing Relationships Between Objects](https://docs.fga.dev/writing-data/managing-relationships-between-objects)
- [OpenFGA Concepts](https://openfga.dev/docs/concepts)

### 日志与控制面

- [Logs](https://auth0.com/docs/deploy-monitor/logs)
- [Log Data Retention](https://auth0.com/docs/deploy-monitor/logs/log-data-retention)
- [Retrieve Logs Using the Management API](https://auth0.com/docs/deploy-monitor/logs/retrieve-log-events-using-mgmt-api)
- [Log Streams](https://auth0.com/docs/customize/log-streams)
- [Tenant log `sapi`](https://auth0.com/docs/tenant-logs/management-success/sapi)
- [Dashboard Access by Role](https://auth0.com/docs/get-started/manage-dashboard-access/feature-access-by-role)
