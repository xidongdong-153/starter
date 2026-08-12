# Design：权限矩阵测试（BOLA/BFLA 表驱动测试）

## 1. 文件布局

新增单个测试文件：`apps/api/src/test/permission-matrix.smoke.test.ts`。

不修改产品代码、helpers.ts 或其他测试文件。测试数据全部走内存级
`createTestApp()` 注入的临时 SQLite 与临时文件目录。

## 2. Actor 与资源准备（beforeAll 一次性装配）

| Actor | 构造方式 | 用途 |
| --- | --- | --- |
| `anonymous` | 无 cookie | 401 基线 |
| `viewer` | `register()` 默认角色 viewer（file:list、file:read） | 无 file 写权限、无控制面权限 |
| `ownerA` | `register()` 默认 operator | 文件 owner 一端 |
| `ownerB` | `register()` 默认 operator | BOLA 另一端 |
| `powerUser` | `register()` operator + 自定义角色 `matrix-control`（含 authorization:manage、authorization:read、authorization-audit:read） | 「持有 manage 的非 admin」 |
| `admin` | `register()` + `repository.bootstrapAdminByEmail` | 平台管理员 |

自定义角色创建：`repository.createRole(..., systemContext)`（走既有 repository，
同步写审计，测试内无副作用）。`powerUser` 的 user_roles 追加该角色（`[operator, matrix-control]`，
不含 admin，不违反 SSD）。

资源准备：

- `fileA`：ownerA 上传的 `avatar.png`（image/png，字节内容固定）。
- `fileB`：ownerB 上传的 `notes.txt`（text/plain）。
- 两个文件都带确定性名称，供「资源未被修改」断言比对。

## 3. 表驱动结构

```ts
type ActorKey = "anonymous" | "viewer" | "ownerA" | "ownerB" | "powerUser" | "admin"

interface MatrixCase {
  name: string            // 用例名，it.each 定位用
  actor: ActorKey
  method: "GET" | "PATCH" | "PUT" | "DELETE" | "POST"
  path: (ctx: MatrixContext) => string   // 动态 fileId / userId / roleKey
  body?: unknown
  expectedStatus: number
  expectedCode?: string   // ApiErrorCodes，非 2xx 时断言
  verifyUnchanged?: (ctx: MatrixContext) => Promise<void> | void  // 资源未被修改断言
}
```

- `MatrixContext` 持有：app、runtime、各 actor cookie、fileA/fileB、ownerA/B 的 userId。
- 驱动函数 `runMatrixCase(ctx, tc)`：构造请求 → 断言状态码 + 错误码 → 执行
  `verifyUnchanged`。全部用例走同一个驱动函数。
- 用例表 `matrixCases: MatrixCase[]` 由若干工厂函数拼接（files 段、profile 段、
  控制面段），`it.each(matrixCases)("$name", ...)` 执行，单用例失败可精确定位。
- 顺序约束：所有被拒用例不改变资源状态；owner 成功删除用例放 files 段最后。

## 4. 矩阵定义

### 4.1 files 资源矩阵（BFLA + BOLA）

对 `fileA`（属 ownerA）：

| actor | list | read content | rename | delete |
| --- | --- | --- | --- | --- |
| anonymous | 401 | 401 | 401 | 401 |
| viewer | 200 | 404 BFLA | 403（无权限） | 403（无权限） |
| ownerB | 200 | 404 BOLA | 404 BOLA | 404 BOLA |
| powerUser | 200 | 404 BFLA | 404 BFLA | 404 BFLA |
| admin | 200 | 404 BFLA | 404 BFLA | 404 BFLA |
| ownerA | 200 | 200 | 200（成功后立即改回原名） | 200（放最后） |

反向 BOLA（对 `fileB`，属 ownerB）：ownerA 的 read / rename / delete 各 404，
覆盖「互相不能操作」双向语义。

关键语义断言（写入 spec 的好 case）：

- admin 有全部权限但**不是文件 owner**，对他人文件仍 404 —— 权限不提供跨用户访问能力。
- viewer 有 file:read 但文件不属自己 → 404（BFLA）；没有 rename/delete 权限 → 403（功能级缺失）。
- ownerB 有全部 file 权限但对象不属自己 → 404（BOLA）。

`verifyUnchanged`：

- 被拒的 delete：owner 重新 `GET /api/files`，文件仍存在。
- 被拒的 rename：owner 重新读取，name 仍为原名。
- 被拒的 read：无资源修改，仅断言状态码。

### 4.2 profile 头像矩阵（BOLA）

`PUT /api/profile/avatar`，body 为 `{ fileId: fileA.id }`：

| actor | 期望 |
| --- | --- |
| anonymous | 401 |
| viewer | 404（fileA 不属 viewer） |
| ownerB | 404（BOLA：不能把他人文件设为头像） |
| powerUser | 404 |
| admin | 404 |
| ownerA | 200（成功后 `DELETE /api/profile/avatar` 清理，避免影响后续用例） |

`verifyUnchanged`：被拒后目标 actor `GET /api/profile` 的 `avatarUrl` 为 null。

### 4.3 控制面矩阵

动作：

- 读：`GET /api/authorization/users`（authorization:read）
- 读：`GET /api/authorization/roles/{roleKey}/impact`（authorization:read，用 viewer roleKey）
- 写：`PUT /api/authorization/users/{targetId}/roles`（authorization:manage）
- 写：`POST /api/authorization/roles`（authorization:manage）
- 写：`PUT /api/authorization/roles/viewer/permissions`（authorization:manage）
- 审计读：`GET /api/authorization/audit-events`（authorization-audit:read）

| actor | users 读 | impact 读 | roles 替换写 | role 创建写 | permissions 写 | audit 读 |
| --- | --- | --- | --- | --- | --- | --- |
| anonymous | 401 | 401 | 401 | 401 | 401 | 401 |
| viewer | 403 | 403 | 403 | 403 | 403 | 403 |
| ownerA（无控制面权限） | 403 | 403 | 403 | 403 | 403 | 403 |
| powerUser（有全部控制面权限） | 200 | 200 | 403（非平台管理员） | 403 | 403 | 200 |
| admin | 200 | 200 | 200 | 200 | 200 | 200 |

`verifyUnchanged`（控制面写被拒后）：target 的 roleKeys 不变；viewer 的
permissionKeys 不变（写前读取快照，拒绝后比对）。

### 4.4 admin 特权语义（独立用例）

删除 `admin` 角色的全部 role_permissions 行后：

- `GET /api/me/permissions` 仍返回全部 8 个 permission key（含
  authorization-audit:read 等无 seed 行的 key）。
- `GET /api/authorization/users` 仍 200；`PUT .../roles` 仍 200（写一条再恢复）。

显式覆盖「admin 自动拥有全部已注册权限」分支，与
`authorization-guidelines.md` 的 `findCurrentAuthorization` / `hasPermission`
admin 分支一致。

## 5. 断言工具

文件内私有辅助（不导出）：

- `expectMatrixFailure(response, status, code)`：状态码 + `ApiErrorCodes` 断言。
- `uploadFile(app, cookie, name, content, mime)`：复用 FormData 上传，返回 FileItem。
- `readFileList(app, cookie)`、`readProfile(app, cookie)`：供 verifyUnchanged 使用。
- `grantRoleToUser(db, userId, roleKey)` / `grantPermissionToRole(db, roleKey, key)`
  风格与现有 authorization.smoke.test.ts 一致（本文件内重定义，不跨文件 import）。

## 6. 边界与风险

- 用例顺序依赖仅存在于「ownerA 成功 delete fileA」放最后；其余用例互相独立。
- `it.each` 共享 beforeAll 的 app 实例；cleanup 放 afterAll（`createTestApp` 的
  cleanup 幂等）。
- 不与现有测试文件并行冲突：每个文件独立 createTestApp，临时目录互不相干。
- 不新增依赖：仅 vitest、已有 contracts、drizzle 查询（只读快照用）。
