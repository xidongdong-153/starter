# Admin 权限规范

## 1. Scope / Trigger

当 Admin 需要按 API 返回的 permission 控制菜单、标签、路由或动作时，使用本规范。前端只负责体验层控制，API middleware 仍是唯一安全边界。

## 2. Signatures

```ts
export interface AdminRouteRecord {
  permission?: Permission
}

await requireAdminRoutePermission(
  context.queryClient,
  PermissionKeys.AUTHORIZATION_READ,
)
```

```tsx
<PermissionGuard permission={PermissionKeys.FILE_DELETE}>
  <DeleteButton />
</PermissionGuard>
```

当前权限 query：

```ts
export const currentPermissionsQueryOptions = queryOptions({
  queryKey: authorizationQueryKeys.current(),
  queryFn: getCurrentPermissions,
  refetchOnWindowFocus: true,
  staleTime: 30_000,
})

const activeRolesKey = authorizationQueryKeys.roles('active')
const archivedRolesKey = authorizationQueryKeys.roles('archived')
const roleImpactKey = authorizationQueryKeys.roleImpact(roleKey)
const permissionImpactKey = authorizationQueryKeys.permissionImpact(permissionKey)
```

## 3. Contracts

- 当前权限只由 `GET /api/me/permissions` 提供，保存在 TanStack Query，不放 Zustand 或 localStorage。
- `hasPermission` 是菜单、标签栏、route guard 和 `usePermission` 使用的纯判断函数；permission key 必须从 `@starter/contracts` 导入。
- 带 `record.permission` 的子 route 在 `beforeLoad` 调用 `requireAdminRoutePermission`。父布局只检查 session。
- 权限 query 成功但缺少 permission 时重定向到已登录的 `/403`；权限 query 失败时抛出原错误给 ErrorBoundary，不当作无权限。
- `buildNavigationMenuItems`、移动 Drawer 和 `TabBar` 在权限未加载或失败时隐藏受保护记录，不能保留上一个账号的高权限标签。
- `PermissionGuard` 在 loading、失败或缺少权限时默认不渲染 children。需要在页面上展示失败或重试时，由 route ErrorBoundary 或 `PermissionQueryStatus` 提供明确状态。
- `api/http.ts` 的 access-error listener：401 清空 Query cache 并跳 `/login`；403 只失效当前权限 query，不退出登录。
- 文件页面分别使用 `file:read`、`file:upload`、`file:rename`、`file:delete` 控制图片、下载和各写动作；文件路由使用 `file:list`。
- `/settings/authorization-audit` 使用独立的 `authorization-audit:read`，不要求同时持有 `authorization:read` 或 `authorization:manage`。
- 审计列表通过 `authorization.api.ts` 和 `authorization.query.ts` 读取，query key 必须包含 page、pageSize 和全部筛选条件；数据不写入 Zustand 或 localStorage。
- 审计组件只接收 contracts 的结构化 before/after 判别联合，不读取 `before_json`、`after_json`，也不调用 `JSON.parse`。
- action、actor ID、target ID 和时间范围筛选保存在页面 state；分页或筛选变化由 TanStack Query 发起新请求。当前路由没有 search params 校验模式，刷新页面或分享 URL 不保留筛选条件。

### 授权管理页

- `/settings/authorization` 继续使用单一路由，包含用户角色、角色权限和权限影响三个 Tab。
- 活动与归档角色目录使用不同 query key；用户角色分配、创建表单和 Permission Tab 始终读取活动角色响应中的 permission 目录，不能跟随归档状态切换到另一份缓存。
- `AuthorizationRole` 的 `metadataEditable`、`permissionsEditable` 和 `lifecycleEditable` 决定操作是否显示。客户端不根据 `admin`、`operator`、`viewer` 再写一套判断。
- 创建表单只允许从 permission Tree 选择注册项。名称生成 key 建议值时使用 ASCII 规则，不做中文拼音转换；`keyTouched=true` 后名称变化不能覆盖管理员已经修改的 key。
- metadata Drawer 不包含 key 和 permission。permission Drawer 打开时查询 role impact；存在 permission 差异时，impact 查询成功且不处于后台刷新状态后才能打开确认 Modal。
- 归档 Modal 打开时查询最新 role impact。人数大于 0、查询失败或查询仍在刷新时禁用确认；API 返回 409 时重新拉取该 impact 和 active/archived role 目录，其他失败不执行成功后的失效逻辑。
- create、update、archive、restore、用户角色替换和角色 permission 替换成功后，使 current permissions、users、全部 role catalog、role impact 和 permission impact 失效。mutation 失败不执行这组失效。
- permission impact Drawer 展示有效 role key 和去重用户数。任意 role key 放进 Ant Design `Tag` 时，要用内联 `whiteSpace: 'normal'` 和 `overflowWrap: 'anywhere'`；只写 `whitespace-normal` 工具类可能被 Ant 样式覆盖，导致 Drawer 出现横向滚动。
- 没有 `authorization:manage` 时，创建、分配、metadata、permission、归档和恢复操作全部隐藏；影响查询仍可见。直接调用写 API 仍由服务端返回 403。

## 4. Validation & Error Matrix

| 条件 | 路由或 UI 行为 |
| --- | --- |
| 无 session 或 API 返回 401 | 清空 Query cache，跳 `/login` |
| permission query 成功但缺少 route permission | 跳 `/403`，session 保留 |
| permission query 500 或网络错误 | ErrorBoundary 或侧栏/Drawer 的重试状态；不显示受保护导航 |
| API mutation 返回 403 | 保持登录，失效并刷新当前权限 query，显示 mutation 错误；`PermissionGuard` 随新结果隐藏写操作 |
| 创建 key 冲突返回 409 | 保留表单输入，显示服务端错误，不关闭 Drawer |
| 归档返回 `AUTH.ROLE_IN_USE` 和 409 | 保留 Modal，刷新角色 impact 和角色目录，按服务端人数继续禁用确认 |
| impact 查询 loading 或后台刷新 | permission 保存和归档确认保持禁用，不能使用旧人数提交 |
| impact 查询失败 | Drawer 或 Modal 显示错误和重试动作，不清空已有列表数据 |
| 当前用户失去 role | 重新加载后菜单和标签栏隐藏对应记录，直接 URL 进入 `/403` |
| 当前用户在管理页 | 用户角色编辑按钮禁用；服务端也会拒绝 self mutation |

## 5. Good / Base / Bad Cases

- Good：`/settings/authorization` 标记 `authorization:read`，route guard 拦截直达 URL，菜单和标签栏同步隐藏。
- Good：`/settings/authorization-audit` 只标记 `authorization-audit:read`；审计员可以查看事件，但不会因此获得授权写能力。
- Good：viewer 保留文件读取入口，但上传、重命名和删除按钮由精确 permission 隐藏。
- Good：保存角色 permission 前显示新增、移除项和最新分配人数；归档前人数不为 0 时不提供可提交的确认按钮。
- Good：活动和归档 role catalog、role impact、permission impact 使用不同 query key，mutation 成功后按前缀统一失效。
- Base：只持有 `authorization:read` 的用户可以查看角色和影响，但页面不渲染任何写操作。
- Bad：仅在 `NavigationMenu` 过滤条目，未在 route `beforeLoad` 检查 permission。
- Bad：从角色名称硬转中文拼音，或名称每次变化都覆盖管理员已经确认的 key。
- Bad：归档只使用之前缓存的 impact 人数，不等待后台刷新完成。
- Bad：403 后清空 session，把有效登录态误判为未登录。
- Bad：把完整 permissions response 存进持久化 Zustand，导致换账号或撤销权限后显示旧状态。

## 6. Tests Required

浏览器或组件验收至少覆盖：

- admin、operator、viewer 三种权限集合的菜单、标签栏和直接 URL。
- `/403` 内容、返回首页和上一页动作。
- 当前权限 query 的 loading、失败重试和 403 刷新。
- 授权管理页的 users、active/archived roles 和 permission 目录 loading、空数据、错误与重试。
- key 建议覆盖英文、拉丁组合音标、中文、非法首字符、超长结果和 `keyTouched`。
- create、metadata、permission diff、impact、archive 和 restore 的 pending、成功与失败状态。
- 查询 key 区分 active/archived、role impact 和 permission impact；mutation 失败不失效，成功失效完整授权范围。
- `admin` metadata、permission 和生命周期只读；当前用户角色按钮禁用。
- 只有 `authorization:read` 时写操作全部隐藏；权限撤销并重新加载后进入 `/403`，直接写 API 仍返回 403。
- 文件页的读取和四个写动作分别按 permission 显示。
- 桌面和移动端的长邮箱、role key、permission key、表格横向滚动、Drawer 和 Modal 布局；检查页面本身不能产生横向溢出。
- 审计 route guard 和导航只向 `authorization-audit:read` 持有者开放。
- 审计页的 loading、错误重试、空数据、四个角色 action 的结构化 before/after 和筛选参数提交。

## 7. Wrong vs Correct

### Wrong

```tsx
const menuItems = buildNavigationMenuItems(t)
```

这会让所有登录用户看到受保护菜单，也无法处理权限加载失败。

### Correct

```tsx
const permissionsQuery = useCurrentPermissionsQuery()
const menuItems = buildNavigationMenuItems(
  permissionsQuery.isSuccess ? permissionsQuery.data.permissions : undefined,
  t,
)
```

同一 permission 集合还必须传给 route guard、`PermissionGuard` 和 `TabBar` 过滤，保证不同入口的体验一致。

## 8. 演进边界

> 审计页面、自定义角色生命周期、影响查询和权限回归测试已经实现。后续能力仍需另建任务并同步更新 API、contracts 和前端规范。

### 8.1 已实现的授权控制面

- `/settings/authorization` 管理用户角色、自定义角色 metadata、permission、归档、恢复和两类 impact，不增加第二条管理路由。
- 用户分配只使用活动角色；归档目录用于查找和恢复，不提供 metadata 或 permission 编辑。
- permission 只从注册目录选择，Admin 没有 permission 创建、改名或删除入口。
- 服务端返回 editability 字段，前端只按字段渲染操作。
- 影响查询是提示状态，写入成功与否仍以 API transaction 结果为准。

### 8.2 审计页面与查询

- 通过独立的 `authorization-audit:read` permission 控制 route、菜单、标签和页面入口。
- 使用 API 返回的结构化 before/after DTO；组件不接收数据库 JSON 字符串，也不自行 `JSON.parse`。
- `role.created` 展示名称、描述和初始 permission；`role.updated` 展示 metadata 前后值；归档和恢复展示状态变化。
- 使用现有 Query adapter、query keys、分页和筛选模式，不把审计数据写入 Zustand 或 localStorage。
- loading、空数据、请求失败、403 和 401 分别处理；403 保留 session，401 清理 Query cache 并跳登录。
- 长 role key、permission key、用户 ID 和 request ID 必须在桌面和移动视口内保持可读，不得撑破页面或遮挡操作。

### 8.3 条件能力的前端边界

用户账号停用、恢复、邀请和 Session 撤销不放进角色页面。Organization、机器身份和 FGA 不在默认 Admin 路由、导航记录或权限类型中预留页面；进入对应任务后再增加独立 feature，不把平台 `admin` 显示为 Organization 管理员。
