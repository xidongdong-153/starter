# 授权设计候选契约

> 状态：候选设计，尚未实现。详细取舍和来源见 `.trellis/tasks/08-09-explore-user-permissions/research.md`。实现任务开始前需要按当前 Better Auth 版本重新核对接口。

## 1. Scope / Trigger

当 API 从“只判断是否登录”增加角色和权限校验时使用本契约。目标是让认证身份、数据库授权、HTTP 错误和 Admin UI 使用同一套边界。

## 2. Signatures

后端目标接口：

```ts
const requireAuth = createRequireAuth(runtime.auth);
const requirePermission = createRequirePermission(runtime.db);

app.get("/api/users", requireAuth, requirePermission("user:list"), handler);
```

前端目标接口：

```http
GET /api/me/permissions
Cookie: better-auth.session_token=...
```

```json
{
  "roles": ["operator"],
  "permissions": ["user:list", "file:list"],
  "version": 12
}
```

数据库目标关系：

```text
user -> user_roles -> roles -> role_permissions -> permissions
```

## 3. Contracts

- 权限 key 采用 `resource:action`，例如 `user:list` 和 `user:create`。首版不支持通配符和角色继承。
- `requirePermission` 必须在 `requireAuth` 之后执行，从 Hono `currentUserId` 读取用户，不接受客户端提交的角色或权限集合。
- API 授权查询只使用未归档的 role 和 permission；角色权限关系由数据库事务维护。
- 没有有效 session 返回 401；有 session 但没有所需权限返回 403；数据库异常返回 500。
- Admin 的权限集合只用于路由、菜单、组件和按钮可见性，不能替代 API 授权。
- 权限数据放 TanStack Query，不放 Zustand 或 localStorage；认证仍由 Better Auth cookie 和 `credentials: 'include'` 处理。

## 4. Validation & Error Matrix

| 条件 | HTTP | 错误 code | 客户端行为 |
| --- | --- | --- | --- |
| 没有 session | 401 | `AUTH.UNAUTHENTICATED` | 清空认证查询并跳转登录 |
| session 无效 | 401 | `AUTH.SESSION_INVALID` | 清空认证查询并跳转登录 |
| 已登录但缺少权限 | 403 | `AUTH.FORBIDDEN` | 刷新权限一次，仍无权则显示 403，不退出登录 |
| 权限表查询失败 | 500 | `SYSTEM.INTERNAL_ERROR` | 显示请求失败并允许重试，不默认放行 |
| 有权限但资源不属于当前用户 | 404 或业务规定状态 | 现有资源错误 code | 继续使用 service 的 owner 条件，不由 RBAC 替代 |

## 5. Good / Base / Bad Cases

- Good：`requireAuth` 写入 `currentUserId`，`requirePermission("user:list")` 查询数据库后再进入 handler。
- Base：前端没有 `user:create` 时隐藏创建按钮，但用户直接调用接口仍由 API 返回 403。
- Bad：把前端传来的 `permissions` 数组作为 API 授权依据。
- Bad：收到 403 就清除 session 并退出登录。
- Bad：只在登录时加载一次权限，让角色撤销必须等用户重新登录才生效。

## 6. Tests Required

实现任务至少覆盖：

- 未登录请求受保护 route 返回 401 和 `AUTH.UNAUTHENTICATED`。
- 已登录但无权限请求返回 403 和 `AUTH.FORBIDDEN`。
- 拥有任一角色权限时授权成功；多个角色的权限按并集生效。
- 归档角色或归档权限不再授权。
- 角色修改事务提交后，下一次 API 请求使用新权限。
- `/api/me/permissions` 只返回当前 cookie session 对应用户的权限。
- Admin 权限 query 的 loading、失败、403 刷新和 401 跳转行为。
- 资源 owner 条件仍然生效，单独拥有 `file:delete` 不能删除他人文件。

## 7. Wrong vs Correct

### Wrong

```ts
if (permissionsFromBrowser.includes("user:delete")) {
  return deleteUser();
}
```

这只能控制界面，不能保护 API。

### Correct

```ts
app.delete(
  "/api/users/:id",
  requireAuth,
  requirePermission("user:delete"),
  deleteUserHandler,
);
```

前端可以隐藏按钮，但每次请求仍由服务端根据 `currentUserId` 和数据库关系重新判断。