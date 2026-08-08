# Contracts 数据边界

`@starter/contracts` 不持有数据库，也不导入 Drizzle、better-sqlite3 或文件存储。`ApiMeta` 的 `requestId` 和 ISO timestamp 是传输字段；数据库中的 `Date` 转换发生在 API presenter，例如 `apps/api/src/modules/files/files.presenter.ts`。

Zod schema 描述输入约束，不负责执行数据库查询：

```ts
export const renameFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
});
```

如果字段来自持久化数据，API 负责从 repository record 转换成 DTO，客户端只消费 DTO。不要为了复用类型把数据库列名、Drizzle relation 或 SQLite nullability 直接暴露到 contracts。
