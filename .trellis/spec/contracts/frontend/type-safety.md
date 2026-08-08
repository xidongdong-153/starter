# Contracts 前端类型安全规范

## 输入 schema 与输出 DTO

Zod schema 是 API 输入约束，也是可复用的运行时定义；TypeScript type 使用 `z.infer` 派生，例如 `UpdateProfileInput`。输出 DTO 用显式 interface/type 描述可序列化字段。

```ts
export const socialLinksSchema = z.array(z.url()).max(8);
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
```

## 运行时边界

TypeScript 类型不能验证网络返回值。Web 的 `isPublicProfile` 和 `isAuthConfig`、Admin 的 `apiRequest` wrapper 要继续做 response shape 检查。组件获得已验证数据后再使用 `PublicProfile` 等类型。

使用 `ApiSuccess<T>` 与 `ApiFailure<T>` 的 `ok` 字面量作为 discriminant；不要把 `ApiResponse` 当成永远成功的对象。

## 兼容性

字段改名、nullability 改变、URL 格式改变或 error code 删除都属于跨层变更。先更新 contracts，再同步 API、Admin、Web 和测试；不要在客户端单独声明同名 interface 作为替代。
