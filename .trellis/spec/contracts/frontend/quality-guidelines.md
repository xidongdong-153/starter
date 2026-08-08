# Contracts 前端质量规范

## 检查命令

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/admin check-types
pnpm --filter @starter/web check-types
pnpm test
```

## 变更检查

- 成功 response 的 `data` 和失败 response 的 `error` 都保留 `meta`。
- Web 运行时 guard 覆盖新增字段，Admin 的表单/表格类型仍能通过检查。
- 输入 schema 的 trim、max、nullable 和 URL 限制有对应的成功/失败测试。
- 不把 API 内部 record、cookie、token、文件路径或 UI 实现细节加入共享 DTO。

没有专门的 contracts 测试目录时，使用 API smoke tests 和两个应用的 type-check 验证实际消费者。
