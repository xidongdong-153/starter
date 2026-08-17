# API AI 模块目录重构实施计划

## 当前状态

- Trellis 任务已进入 `in_progress`，API AI 目录重构已完成。
- 已完成 RPC/OpenAPI 代表性检查、六个子域文件迁移、五个子路由拆分和根路由显式组合。
- 已通过 API 类型检查、Lint、Format、全量测试，以及仓库类型检查、Lint、Format、测试和构建。
- 已通过 AI 数据库 `db:check`、`git diff --check`，并更新 `.trellis/spec/api/backend/directory-structure.md`。
- `trellis-check`、任务归档和提交由主会话按工作流继续处理；本代理不执行提交。

## 执行顺序

### 1. 建立重构前基线

- [ ] 记录 `git status --short`，确认并保留 `apps/web/next-env.d.ts` 和其他任务目录的现有改动。
- [ ] 运行 API 类型检查：

```bash
pnpm --filter @starter/api check-types
```

- [ ] 运行全部 API 测试，确认重构前基线通过：

```bash
pnpm --filter @starter/api test
```

失败处理：基线失败时停止实施，记录现有失败，不通过修改无关代码继续推进。

### 2. 先补路由完整性检查

- [ ] 在 `apps/api/src/test/rpc-type.probe.ts` 增加 AI 类型断言，每个目标子路由至少覆盖一个 operation。
- [ ] Configuration 覆盖 Provider 列表或模型偏好，确认具体 response data 没有退化。
- [ ] Usage Audit 覆盖列表 query 和 response item。
- [ ] Conversation 覆盖动态 `conversationId`、JSON body 或具体 response data。
- [ ] Prompt 覆盖系统 Prompt 或模板 operation。
- [ ] Skill 覆盖动态 `id` 和 CRUD method。
- [ ] 在 `apps/api/src/test/openapi.smoke.test.ts` 增加上述五组代表性 path/method 断言。
- [ ] 运行类型检查和 OpenAPI 测试，证明检查在旧结构上先通过：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api exec vitest run --config vitest.config.ts src/test/openapi.smoke.test.ts
```

回滚点：只恢复本步骤新增的检查，不涉及业务文件。

### 3. 移动非路由文件

按 `design.md` 的迁移表逐子域移动文件，保留 Git rename 识别：

- [ ] `configuration/`：OpenAPI、Presenter、Repository、Service。
- [ ] `conversation/`：OpenAPI、Presenter、Repository、Service。
- [ ] `prompt/`：OpenAPI、Repository、Service。
- [ ] `skill/`：OpenAPI、Repository、Service、Skill Tools。
- [ ] `tool/`：Registry、Orchestrator、测试工具。
- [ ] `usage-audit/`：OpenAPI、Presenter、Repository、Service。
- [ ] 更新模块内部相对 import。
- [ ] 更新 `bootstrap/create-runtime.ts`、`scripts/ai-auth.ts` 和 `src/test/*` 的绝对 import。
- [ ] 保持所有现有导出函数、interface 和 type 名称不变。
- [ ] 运行 API 类型检查：

```bash
pnpm --filter @starter/api check-types
```

回滚点：每个子域单独反向移动并恢复其 import；不批量撤销其他已通过子域。

### 4. 拆分 Configuration 与 Usage Audit 路由

- [ ] 新建 `configuration/configuration.route.ts`，移动 13 个配置 operation handler。
- [ ] 把模型测试 SSE helper 一并移入 Configuration Route，保持原控制流不变。
- [ ] 新建 `usage-audit/usage-audit.route.ts`，移动 2 个审计 handler。
- [ ] 根 `ai.route.ts` 创建现有共享 Service 和 guard，并显式挂载两个子路由。
- [ ] 运行配置、审计和模型测试相关检查：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api exec vitest run --config vitest.config.ts src/test/ai.smoke.test.ts src/test/ai-prompt-config.test.ts src/test/ai-usage-audit.test.ts src/test/openapi.smoke.test.ts
```

回滚点：恢复 Configuration/Usage handler 到根路由，删除本步骤新增子路由文件。

### 5. 拆分 Conversation 路由

- [ ] 新建 `conversation/conversation.route.ts`，移动 7 个会话 handler。
- [ ] 移动会话 SSE helper、类型别名和 event writer，保持 heartbeat、abort 和 finally 清理顺序不变。
- [ ] 根路由显式挂载 Conversation Route。
- [ ] 运行会话和契约检查：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api exec vitest run --config vitest.config.ts src/test/ai-conversations.smoke.test.ts src/test/ai-contracts.test.ts src/test/openapi.smoke.test.ts
```

回滚点：恢复会话 handler 和 SSE helper 到根路由。

### 6. 拆分 Prompt 与 Skill 路由

- [ ] 新建 `prompt/prompt.route.ts`，移动 10 个 Prompt handler。
- [ ] 新建 `skill/skill.route.ts`，移动 5 个 Skill handler。
- [ ] 根路由显式挂载 Prompt Route 和 Skill Route。
- [ ] 运行 Prompt、Skill 和权限相关检查：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api exec vitest run --config vitest.config.ts src/test/ai-prompt-config.test.ts src/test/ai-skills.test.ts src/test/permission-matrix.smoke.test.ts src/test/openapi.smoke.test.ts
```

回滚点：分别恢复 Prompt 或 Skill handler，不同时撤回两个子域。

### 7. 整理根路由和静态检查

- [ ] `ai.route.ts` 只保留公共依赖装配、Service 创建和五个子路由的显式组合。
- [ ] `index.ts` 继续只导出 `createAiRoute`。
- [ ] `ai.schema.ts` 保留根目录且内容不变。
- [ ] 检查旧平铺文件和旧 import 已清除：

```bash
rg --files apps/api/src/modules/ai | sort
rg -n '@api/modules/ai/(ai-(conversation|prompt|skill|tool|usage)|test-tools)|from "\./ai-(conversation|prompt|skill|tool|usage)' apps/api/src --glob '*.ts'
```

- [ ] 检查 `@earendil-works/pi-ai` 仍只由 `infra/ai` 导入：

```bash
rg -n '@earendil-works/pi-ai' apps/api/src
```

- [ ] 检查 diff 中没有 Contracts、migration、Admin/Web 业务代码变化。

### 8. 全量验证

按项目质量门顺序运行：

- [ ] 类型检查：

```bash
pnpm check-types
```

- [ ] Lint：

```bash
pnpm lint
```

- [ ] Format：

```bash
pnpm format:check
```

- [ ] 全仓库测试：

```bash
pnpm test
```

- [ ] 全仓库构建，验证 `@starter/api/rpc` 的 Admin/Web 消费：

```bash
pnpm build
```

- [ ] AI 数据库定义未发生漂移：

```bash
pnpm --filter @starter/api db:check
```

- [ ] Git whitespace 检查：

```bash
git diff --check
```

任何命令失败时停在失败步骤，只修复本任务引入的问题，然后从该命令重新执行。

### 9. 完成前检查

- [ ] 使用 `trellis-check` 检查 PRD、设计、目录、import、RPC 类型、OpenAPI、SSE 和测试结果。
- [ ] 按检查结果更新 `.trellis/spec/api/backend/directory-structure.md`，只增加复杂模块允许按内部业务子域分目录的可执行规则和 AI 目录实例。
- [ ] 再次运行受 spec 修改影响的 Format 检查。
- [ ] 汇总改动、验证结果和未验证项。
- [ ] 未经用户确认，不执行 `git commit` 或 `git push`。

## 验收映射

| 验收条件 | 对应步骤 |
| --- | --- |
| 子域目录清晰 | 3、7 |
| `createAiRoute` 与 RPC 入口不变 | 2、4、5、6、8 |
| HTTP/OpenAPI/权限行为不变 | 2、4、5、6、8 |
| SSE 行为不变 | 4、5、8 |
| 数据库不变 | 7、8 |
| 全部质量检查通过 | 8、9 |
| 可分步回滚 | 2 至 6 的各回滚点 |

## 风险文件

- `apps/api/src/modules/ai/ai.route.ts`：37 个 operation 的原始注册点。
- `apps/api/src/modules/ai/conversation/conversation.route.ts`：会话 SSE 的取消与终态处理。
- `apps/api/src/modules/ai/configuration/configuration.route.ts`：模型测试 SSE。
- `apps/api/src/routes/index.ts`、`apps/api/src/rpc.ts`：只读验证，不计划修改。
- `apps/api/src/test/rpc-type.probe.ts`：Hono RPC 类型完整性检查。
