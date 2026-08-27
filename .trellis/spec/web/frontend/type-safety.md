# Web 类型安全规范

## 共享 DTO 与运行时校验

跨应用的类型从 `@starter/contracts` 导入。由于 HTTP response 在运行时仍是不可信数据，`lib/api/profile.api.ts` 和 `lib/api/auth-config.api.ts` 先用本地 type guard 校验，再返回 `PublicProfile` 或 `AuthConfig`。

两种写法的分界：字段扁平的 DTO（`PublicProfile`、`AuthConfig`）继续用本地 guard；嵌套判别联合（`RunEvent`、`AgentTranscript`、`AgentRunLiveSnapshot`）用 contracts 导出的 zod schema `safeParse`，见 `lib/ai/run-event-stream.ts` 和 `lib/api/ai-chat.api.ts`。手写事件 guard 等于把协议复制到 Web，协议一改两边就会错开。

```tsx
export async function getPublicProfile(userId: string): Promise<PublicProfile> {
  const data = await apiRequest(`/api/profiles/${encodeURIComponent(userId)}`, {
    cache: "no-store",
  });
  if (!isPublicProfile(data)) throw new Error("公开资料的数据格式不正确。");
  return data;
}
```

## React props 和常量

布局 children 使用 `Readonly<{ children: React.ReactNode }>`；导航、首页 section 和主题名称使用 `as const` 保留字面量类型。事件处理器从 React 事件对象读取值，不把 `unknown` 直接当成 DTO。

## 环境变量

客户端 API URL 通过 `lib/env.client.ts` 的 schema/解析逻辑读取。不要从 `process.env` 直接读取未声明的值，也不要把 `BETTER_AUTH_SECRET`、数据库路径或文件目录导入客户端组件。

## URL 与错误

用户 ID 进入 URL 前使用 `encodeURIComponent`；API error 分支根据 `ApiRequestError.status` 或 contracts error code 处理，不根据中文 message 做类型判断。
