# NIST RBAC 标准（INCITS 359）调研

> 调研对象：NIST / ANSI INCITS 359 角色访问控制标准，映射到当前脚手架的全局 RBAC 实现。
>
> 调研日期：2026-08-12
>
> 结论先行：INCITS 359 分 Core / Hierarchical / Constrained 三层。当前脚手架已实现 Core RBAC 的主体（UA、PA、多角色权限并集），缺少标准的 session（激活角色）概念；本次落地 Constrained 层中的静态职责分离（SSD）——互斥角色组 + admin 独占角色；不实现 DSD（动态职责分离）、Hierarchical（角色继承）和 cardinality，理由见第 5 节。

## 1. 标准概述

- INCITS 359 是美国国家标准（ANSI/INCITS），全称 "Role Based Access Control"，2004 年发布，2012 年修订。它把 RBAC 抽象成一组可配置的产品功能，而不是单一实现。
- 标准的前身是 Sandhu 等人 1996 年发表的 RBAC96 模型论文（IEEE Computer），标准中的 Core / Hierarchical / Constrained 分层结构来自该论文的 RBAC0 / RBAC1 / RBAC2 模型。
- 标准把 RBAC 能力分为四层（参考实现可逐层叠加）：
  1. Core RBAC：用户、角色、权限、session 四类元素和两类分配关系。
  2. Hierarchical RBAC：角色继承。
  3. Constrained RBAC：静态职责分离（SSD）与动态职责分离（DSD）。
  4. Symmetric RBAC（可选）：角色与权限之间增加权限角色分配的可选约束，脚手架不涉及。

## 2. Core RBAC 正式元素

标准定义以下集合和关系（RBAC96 记法）：

| 元素 | 定义 | 含义 |
| --- | --- | --- |
| `USERS` | 用户集合 | 授权主体 |
| `ROLES` | 角色集合 | 权限聚合单元 |
| `PRMS` | 权限集合 | 对对象上操作（operation + object）的批准 |
| `SESSIONS` | 会话集合 | 用户与激活角色的绑定 |
| `UA ⊆ USERS × ROLES` | 用户角色分配 | 用户获得角色的静态关系 |
| `PA ⊆ PRMS × ROLES` | 权限角色分配 | 角色获得权限的静态关系 |
| `session_roles(s)` | 会话激活角色 | 用户在会话中实际激活的角色子集 |
| `session_users(s)` | 会话用户 | 会话对应的用户 |

关键性质：

- **权限只能经角色授予**：`PA` 是权限到用户的唯一通道，标准不允许用户直接持有权限。当前脚手架同样禁止用户直授权限。
- **有效权限 = 激活角色权限并集**：用户在会话中的权限是 `session_roles(s)` 中所有角色权限的并集。注意标准中的权限来自"激活的角色"，不是"分配的全部角色"——这是当前脚手架与标准的主要差异（见第 4 节映射表）。
- `assigned_users(r)` / `assigned_permissions(r)` 是角色关联的反向视图，用于回答"谁有该角色""该角色能做什么"——当前脚手架的影响分析（`/api/authorization/roles/{roleKey}/impact`）就是这两个视图的实现。

## 3. Constrained RBAC：SSD 与 DSD

### 3.1 SSD（静态职责分离）

- 形式化定义：`⟨rs, n⟩`，其中 `rs` 是角色集合、`n >= 2`。约束禁止任何用户被分配 `rs` 中 `n` 个或更多角色。
- 最常用实例是冲突角色对（conflicting roles）：`⟨{roleA, roleB}, 2⟩` 表示同一用户不能同时拥有 roleA 和 roleB。
- SSD 约束发生在**用户角色分配（UA）层**，与 session 无关，因此它在分配时即可静态判定、静态执行。
- SSD 的目的：防止利益冲突（separation of duties），例如同一人不能既发起又审批同一笔操作。

### 3.2 DSD（动态职责分离）

- 形式化定义：`⟨rs, n⟩`，禁止任何用户在同一 session 中**激活** `rs` 中 `n` 个或更多角色。
- 与 SSD 的区别：DSD 允许用户被分配多个互斥角色，只限制"同时激活"；用户可以在不同 session 中激活不同角色。因此 DSD 依赖 session（激活角色）概念，必须在会话建立/角色激活时判定。
- 在"一个用户一个长会话、会话内角色固定"的应用形态下，DSD 与 SSD 的最终效果等价，DSD 多出的价值是"同一个人可切换身份"。

### 3.3 Cardinality（角色基数）

- 标准把 cardinality 作为可选功能需求：限制一个用户最多持有的角色数、一个角色最多分配的用户数、角色可以持有的权限数等。
- 它在标准中不属于 SSD/DSD 的正式约束类，属于管理控制项。

## 4. 标准元素 → 当前脚手架映射表

| 标准元素/能力 | 脚手架现状 | 分类 |
| --- | --- | --- |
| `USERS` | Better Auth `user` 表 | 已实现 |
| `ROLES` | `roles` 表（key、is_system、archived_at） | 已实现 |
| `PRMS` | `permissions` 表（resource + action，`key = resource:action`） | 已实现 |
| `SESSIONS` + `session_roles` | 无。当前权限计算取用户全部未归档角色的并集，没有激活角色子集 | 未实现，本次不做 |
| `UA` | `user_roles` 表，`replaceUserRoles` 整体替换 | 已实现 |
| `PA` | `role_permissions` 表，`replaceRolePermissions` 整体替换 | 已实现 |
| 权限只能经角色授予 | 无用户直授权限 | 已实现 |
| 有效权限 = 角色权限并集 | `authorization.service` 计算全部未归档角色权限并集（比标准多出"全部"而非"激活"） | 部分实现 |
| `assigned_users` / `assigned_permissions` | 角色影响分析（role impact） | 已实现 |
| Hierarchical RBAC（RH 角色继承） | 无；历史规划明确不做 | 不做 |
| SSD（静态职责分离） | 无互斥约束 | **本次落地** |
| DSD（动态职责分离） | 无 session 概念 | 不做（见第 5 节） |
| Cardinality | 无数量上限 | 不做 |

## 5. SSD 落地语义与不做项理由

### 5.1 SSD 语义选择

- 标准的形式是 `⟨rs, n⟩`（一组角色中至多分配 n-1 个）。本次只落地最常用实例 `n = 2`，即互斥角色组：组内角色两两互斥，一个用户至多持有组内一个角色。
- 额外支持单元素互斥组（独占角色）：组内只有一个角色时，语义变为"持有该角色则不能持有任何其他角色"。这是 `⟨rs, 2⟩` 的推广表达，用于平台根角色 `admin` 的独占治理，避免为"admin 与每个角色互斥"写 N 个互斥对。
- 预置互斥组 `[['admin']]`：admin 是平台根角色（自动获得全部已注册权限），独占语义防止 admin 权限与普通业务角色叠加，避免角色事实来源混淆。

### 5.2 不做项理由

| 能力 | 不做理由 | 未来引入条件 |
| --- | --- | --- |
| DSD | 当前无 session 激活角色概念，权限计算为"全部角色并集"；管理后台是单会话固定身份形态，DSD 与 SSD 效果等价。引入 DSD 需要新增激活角色数据模型、改造授权查询和 `/api/me/permissions` | 出现"同一用户需要切换身份执行互斥操作"的产品需求时，与 session 模型一起设计 |
| Hierarchical RBAC | 角色继承引入权限传递的隐性来源，影响分析与审计的直观性下降；历史规划（`08-09-permission-role-evolution`）已明确近期不做 | 角色数量膨胀到需要继承简化管理时，优先评估"聚合角色/组"而非继承 |
| Cardinality | 当前角色数量少、管理后台规模小，无实际需求 | 出现角色/权限数量失控迹象时，作为管理控制项单独设计 |

### 5.3 存量数据与校验时机

- 互斥约束只在校验写入路径（`replaceUserRoles` 事务内）执行；幂等提交（无变化）放行，存量违规数据不扫描、不自动修改。理由：用户角色只能经整体替换写入，下一次实际修改时自然被校验拦截；避免破坏性迁移。
- 校验位置在事务内、幂等短路之后、last-platform-admin 检查之前，保证"拒绝互斥组合"优先于"拒绝移除最后一个平台管理员"。

## 6. 来源与待确认项

来源（权威、公开可获取）：

- Sandhu, R., Coyne, E., Feinstein, H., Youman, C. "Role-Based Access Control Models". IEEE Computer, Vol. 29, No. 2, 1996. RBAC96 模型（RBAC0/1/2/3），是 INCITS 359 的前身与分层依据。
- ANSI/INCITS 359-2012, "Role Based Access Control". 美国国家标准；正文需购买，本次调研基于标准公开摘要与学术解读。
- NIST 对 RBAC 的公开介绍与相关出版物（如 NIST SP 800-162 指南中对 RBAC/ABAC 的对比讨论）。

待确认项：

- INCITS 359-2012 正文中的 cardinality 章节是否属于正式约束类（本报告按"可选管理控制项"处理）——标准正文需购买核验。
- 标准是否对"独占角色"（单元素互斥组）有正式定义——本报告按 `⟨rs, 2⟩` 的推广表达处理，标准正文未见该命名，属实现层语义扩展。
