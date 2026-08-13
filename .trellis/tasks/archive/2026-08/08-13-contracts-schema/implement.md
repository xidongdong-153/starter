# 实现计划：统一 contracts 与响应 schema

## 阶段 0：确认基线

1. 读取 `packages/contracts/src/index.ts`、所有 API `*.openapi.ts`、presenter、Web/Admin API 函数和相关 smoke tests。
2. 记录根入口导出名称，搜索 contracts 与 API 的重复 schema/type。
3. 在不改代码的前提下运行 contracts/API/Web/Admin 的类型检查，并记录现有真实响应测试入口。

检查：

```bash
rg -n "export (const|type|interface|function)|Schema|schema" packages/contracts/src/index.ts apps/api/src/modules apps/api/src/openapi
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
```

## 阶段 1：拆分文件并保持根导出

1. 从旧 `index.ts` 按 common/auth/profile/files/users/authorization/system 移动声明，避免顺手改名或格式化无关代码。
2. 新 `index.ts` 按稳定顺序重导全部现有公共名称。
3. 确认所有跨文件 import 使用 `.js` 后缀，contracts package 仍只有 `zod` runtime dependency。
4. 对公共类型改用对应 schema 的 `z.infer`/输出类型；只有无法由 schema 表达的内部日志 record 等保持明确的序列化类型。

检查：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
```

回滚点：恢复旧入口内容或临时让根入口重新导出兼容文件；不修改调用方路径。

## 阶段 2：迁移 API OpenAPI schema 来源

1. 将 system/auth/profile/files/users/authorization 的 response data schema 和重复 request schema 改为引用 contracts。
2. API 层只保留 `createRoute` 所需的 path wrapper、OpenAPI 名称/描述/tag/security 和 status map。
3. 修正 `from`、审计状态事件、相对头像 URL、错误码和实际错误状态声明。
4. 确认 multipart/二进制/Better Auth 仍使用专用声明和 handler，不把 `File` 或原始 Response 放进普通 JSON DTO。
5. 对照 presenter 和 service 返回值，删除本次迁移产生的无用本地 schema/import。

检查：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
pnpm --filter @starter/api build
```

## 阶段 3：真实响应契约测试

1. 在现有 API smoke test 边界增加共享 schema parse helper，或者增加窄的 contract smoke test 文件。
2. 解析一个 2xx success envelope、一个 4xx failure envelope 和一个包含状态/审计漂移字段的真实 JSON。
3. 保留 `meta`、error code 和实际状态码断言。
4. 确认测试使用 `app.request()`，不读取生产发送前的 cast 类型。

检查：

```bash
pnpm --filter @starter/api test
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/web check-types
pnpm --filter @starter/admin check-types
```

## 阶段 4：联合检查与交接

1. 搜索重复 DTO 和 schema，确认内部域文件没有成为公共 import 路径。
2. 检查 `/doc` 中代表性 operation 的字段和状态码仍存在。
3. 记录变更文件、测试命令和任何原有未修问题。
4. 将“contracts 根入口稳定、普通 JSON schema 唯一来源、特殊接口保留专用边界”作为交接事实，供 `api-rpc-boundary` 使用。

最终顺序：

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/api check-types
pnpm --filter @starter/api test
pnpm --filter @starter/web check-types
pnpm --filter @starter/admin check-types
```

完成后不启动下一个任务，先执行子任务级检查并等待父任务流程决定是否进入 API 子任务。
