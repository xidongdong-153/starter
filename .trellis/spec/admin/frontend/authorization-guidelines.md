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

## 4. Validation & Error Matrix

| 条件 | 路由或 UI 行为 |
| --- | --- |
| 无 session 或 API 返回 401 | 清空 Query cache，跳 `/login` |
| permission query 成功但缺少 route permission | 跳 `/403`，session 保留 |
| permission query 500 或网络错误 | ErrorBoundary 或侧栏/Drawer 的重试状态；不显示受保护导航 |
| API mutation 返回 403 | 保持登录，失效并刷新当前权限 query，显示 mutation 错误 |
| 当前用户失去 role | 重新加载后菜单和标签栏隐藏对应记录，直接 URL 进入 `/403` |
| 当前用户在管理页 | 用户角色编辑按钮禁用；服务端也会拒绝 self mutation |

## 5. Good / Base / Bad Cases

- Good：`/settings/authorization` 标记 `authorization:read`，route guard 拦截直达 URL，菜单和标签栏同步隐藏。
- Good：viewer 保留文件读取入口，但上传、重命名和删除按钮由精确 permission 隐藏。
- Base：角色 mutation 成功后使 users、roles 和 current permissions query 失效。
- Bad：仅在 `NavigationMenu` 过滤条目，未在 route `beforeLoad` 检查 permission。
- Bad：403 后清空 session，把有效登录态误判为未登录。
- Bad：把完整 permissions response 存进持久化 Zustand，导致换账号或撤销权限后显示旧状态。

## 6. Tests Required

浏览器或组件验收至少覆盖：

- admin、operator、viewer 三种权限集合的菜单、标签栏和直接 URL。
- `/403` 内容、返回首页和上一页动作。
- 当前权限 query 的 loading、失败重试和 403 刷新。
- 授权管理页的 users、roles loading、空数据、错误、Modal 保存和 pending。
- `admin` 权限只读、当前用户角色按钮禁用。
- 文件页的读取和四个写动作分别按 permission 显示。
- 桌面和移动端的长邮箱、permission key、表格横向滚动和弹窗布局。

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

## 8. 已批准的演进边界（尚未实现）

> 本节记录任务 `permission-role-evolution` 的已批准规划。当前 Admin 仍按前面各节的已实现行为运行；后续实现必须另建任务并同步更新 API、contracts 和前端规范。

### 8.1 审计页面与查询

下一项实现任务会增加只读 authorization audit 页面：

- 通过独立的 `authorization-audit:read` permission 控制 route、菜单、标签和页面入口。
- 使用 API 返回的结构化 before/after DTO；组件不接收数据库 JSON 字符串，也不自行 `JSON.parse`。
- 使用现有 Query adapter、query keys、分页和筛选模式，不把审计数据写入 Zustand 或 localStorage。
- loading、空数据、请求失败、403 和 401 分别处理；403 保留 session，401 清理 Query cache 并跳登录。
- 长 permission key、用户 ID 和 request ID 必须在桌面和移动视口内保持可读，不得撑破表格或遮挡操作。

### 8.2 权限回归测试

Admin 新增 Vitest `test` script 后，根目录 `pnpm test` 必须同时运行 API 与 Admin 测试。最小回归范围包括：

- admin、operator、viewer 的菜单、标签、直接 URL 和按钮差异。
- 权限 query 的 loading、失败重试、403 刷新和 401 跳转。
- 授权页面的加载、空数据、错误、保存 pending 和 admin 只读状态。
- 前端 permission 隐藏不能替代 API guard；直接请求仍以服务端 403 为准。

### 8.3 条件能力的前端边界

Organization、机器身份和 FGA 不在默认 Admin 路由、导航记录或权限类型中预留页面。进入对应业务任务后，再根据其唯一 principal、组织上下文或外部 provider 合同增加独立 feature；不把平台 `admin` 自动显示为每个 Organization 的管理员。
