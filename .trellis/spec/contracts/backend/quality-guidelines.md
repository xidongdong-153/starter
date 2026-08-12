# Contracts 后端质量规范

## 检查命令

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
```

## 契约变更检查

- Zod schema 的字段名、trim、nullable、长度、URL 和数组上限与 API route 使用一致。
- response builder 仍返回正确的 `ok` discriminant 和 `meta`。
- DTO 不包含数据库内部字段；公开资料不能混入 account email 等私有字段。
- `uuidSchema` 继续使用 uuidv7 约束，和 API 生成 ID 的格式一致。
- API smoke tests 覆盖新增字段的成功和失败边界，Admin/Web 类型检查覆盖消费方。

contracts 是共享边界，不能只运行本包 type-check 就宣称变更完成。

## 修改 contracts 后运行独立 tsx 脚本前必须先 build

`@starter/contracts` 的 package exports 用 `development` condition 指向 `src/index.ts`，
dev 服务（tsx watch / vite）直接读源码；但独立 tsx 脚本（如
`apps/api/src/scripts/bootstrap-admin.ts`）不带 development condition，
解析到 `dist/` 旧构建产物，会报 "does not provide an export named X"。

修改 contracts 源码后，运行这类脚本前先：

```bash
pnpm --filter @starter/contracts build
```
