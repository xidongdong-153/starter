# API 内置 AI Tool Catalog 实施计划

## 0. 执行约束

- 实施 Agent：由当前 Pi 会话通过原生 `trellis_subagent` 派发 `trellis-implement`。
- 模型：Pi 内 `opencode-go` Provider 的 `deepseek-v4-flash`，完整标识 `opencode-go/deepseek-v4-flash`。
- `trellis_subagent` 参数：`mode: single`、`thinking: max`。
- 派发 prompt 第一行必须是当前 active task 路径，并明确子 Agent 已经是 `trellis-implement`，不得再派发 `trellis-implement` 或 `trellis-check`。
- 不允许自动替换其他 Provider 或模型；指定模型派发失败时停止并报告。
- 实施前依次读取 `prd.md`、`design.md`、本文件、`implement.jsonl` 和其中引用的 spec/research。
- 一次只完成一个阶段；阶段结束运行该阶段的最小验证，再进入下一阶段。
- 不创建独立 Tool package，不增加动态 Tool、远程 Tool、Tool 数据表或兼容读取分支。
- 不提交、不推送；完成检查后由主会话展示改动摘要并取得用户确认。

## 1. 完成标准

以下条件全部满足才算实现完成：

1. Contracts 只接受 schema v2 和结构化精确 `toolRefs`。
2. Registry 只按精确 ref 查询，Catalog 有单一显式组装入口。
3. Agent Service 拒绝未知 ref 和同名多版本。
4. Run Service 把已解析 Tool 直接交给 Executor，Executor 不查 Registry。
5. Adapter 完成参数大小、Zod、scope、Principal 权限、timeout、取消、结果和审计校验。
6. Tool audit 新记录保存版本，历史版本允许 null。
7. Admin 选择、显示和提交精确 Tool 版本。
8. v1、`toolNames` 和版本范围没有兼容路径。
9. 相关局部测试和仓库完整质量检查全部通过。
10. Spec 更新反映最终 contract，文档与源码一致。

## 2. 阶段一：Contracts 破坏性升级

### 2.1 修改文件

- `packages/contracts/src/ai.ts`
- `apps/api/src/test/ai-harness-contracts.test.ts`
- 所有直接构造 Agent config / Run snapshot 的测试 fixture。

### 2.2 实施步骤

- [ ] 增加 `aiToolNameSchema`，复用 Registry 当前名称规则或确保 contracts 与 API 规则完全一致。
- [ ] 增加精确三段数字版本 schema；不接受前缀 `v`、预发布标签、build metadata、范围或 `latest`。
- [ ] 增加 `aiToolRefSchema` 和 `AiToolRef`。
- [ ] 增加 `agentToolRefsSchema`：最多 64 项，拒绝完全重复 ref。
- [ ] 把 `agentDefinitionConfigSchema.schemaVersion` 改为字面量 `2`。
- [ ] 把 `toolNames` 改为 `toolRefs`。
- [ ] 修改 `defaultAgentDefinitionConfig`。
- [ ] 把 `agentRunSnapshotSchema.schemaVersion` 改为 `2`，字段改为 `toolRefs`。
- [ ] 保持 `AiToolSummary` 的公开字段；版本字段改用同一版本 schema。
- [ ] 给 `AiToolExecutionAuditSummary` 增加 nullable `toolVersion`。
- [ ] 删除所有 v1 schema、union、transform 和默认版本推断；不要保留 deprecated alias。
- [ ] 更新 contracts 单元和 harness contract 测试，明确断言 v1、`toolNames`、缺版本、范围版本和重复 ref 失败。
- [ ] 全仓搜索 `schemaVersion: 1` 和 `toolNames`，建立待修改清单；只处理 Agent/Run Tool 相关命中，避免误改其他 schema。

### 2.3 局部验证

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/contracts lint
pnpm --filter @starter/contracts format:check
pnpm --filter @starter/contracts build
pnpm --filter @starter/api exec vitest run src/test/ai-harness-contracts.test.ts --config vitest.config.ts
```

### 2.4 回滚点

如果 contracts build 后 API/Admin 出现大量类型错误，先确认错误都来自预期的 `toolNames -> toolRefs` 破坏性变更；不要加 alias 消除错误。保留类型错误作为后续阶段的修改清单。

## 3. 阶段二：Registry 和 Catalog

### 3.1 修改文件

- `apps/api/src/modules/ai/tool/tool-registry.ts`
- 新增 `apps/api/src/modules/ai/tool/tool-catalog.ts`
- `apps/api/src/modules/ai/tool/test-tools.ts`
- `apps/api/src/modules/ai/skill/skill-tools.ts`
- `apps/api/src/bootstrap/create-runtime.ts`
- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/test/ai-test-tools.test.ts`

### 3.2 实施步骤

- [ ] `AiToolDefinitionInput.version` 改为必填；所有 Tool 显式写版本。
- [ ] `scope` 是否必填按 PRD 执行：生产定义显式写 `platform` 或固定 scope，不再依靠隐式默认。
- [ ] `AiToolExecutionContext` 的 `principal`、`scope`、`requestId`、`signal`、`reportProgress` 全部必填。
- [ ] 从 handler context 删除裸 `userId`。
- [ ] `AiToolRegistry.find` 改为接收 `AiToolRef`，删除无版本参数。
- [ ] 增加内部 canonical key 函数；只用于 Registry，不进入公开 DTO。
- [ ] `list()` 返回新数组，定义和集合都保持只读。
- [ ] 实现 `listPublic()`，只投影 `name/version/description/scope`。
- [ ] 保留同名不同版本注册能力；继续拒绝重复 `name@version`。
- [ ] 新增 `createBuiltinAiToolRegistry()`，显式合并 runtime 注入 Tool、`read_skill` 和启用的测试 Tool。
- [ ] `ai.route.ts` 只通过 Catalog factory 创建最终 registry。
- [ ] 避免在 `create-runtime.ts` 和 `ai.route.ts` 各自拼一套生产 Tool；RuntimeDeps 只保留测试注入用途。
- [ ] 测试覆盖精确 find、无版本 API 被类型移除、重复 ref、同名多版本、公开投影不含 schema/handler。

### 3.3 局部验证

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-test-tools.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
```

### 3.4 回滚点

如果 Catalog 组装导致 skill repository 重复实例化，不把 repository 创建塞进 `create-runtime.ts`。Catalog 应在 `ai.route.ts` 已创建 `skillRepository` 后组装。

## 4. 阶段三：Agent Definition 精确版本

### 4.1 修改文件

- `apps/api/src/modules/ai/agent/agent.service.ts`
- `apps/api/src/modules/ai/agent/agent.presenter.ts`
- `apps/api/src/modules/ai/agent/agent.openapi.ts`
- `apps/api/src/test/ai-agent-definitions.test.ts`
- Prompt/Provider 引用检查中解析 Agent config 的代码和测试。

### 4.2 实施步骤

- [ ] `normalizeConfig()` 对 `toolRefs` 按 `name`、`version` 稳定排序。
- [ ] `sameConfig()` 改为比较结构化 refs，不做 JSON 字符串比较。
- [ ] `validateConfig()` 精确调用 `toolRegistry.find(ref)`。
- [ ] 增加单个 Agent 同名多版本检查；错误保持 `AI_AGENT_CONFIG_INVALID` 和安全 resource details。
- [ ] `resolve()` 返回与 refs 一一对应且顺序稳定的 `RegisteredAiTool[]`。
- [ ] scope 检查继续在 resolve 时执行；创建/更新时至少检查 ref 存在和结构冲突。
- [ ] `listTools()` 改为 registry 的公开投影，不手工复制内部字段。
- [ ] 更新 Agent CRUD、revision、draft/enable、缺失 Tool、同名多版本和 v1 损坏配置测试。
- [ ] 确认 Prompt 删除引用检查解析 v2 config；损坏或 v1 config 仍禁止绕过引用保护。

### 4.3 局部验证

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-agent-definitions.test.ts src/test/ai-prompts.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
```

### 4.4 回滚点

不要为修复旧 fixture 增加 runtime 兼容。fixture 应直接改为 schema v2。

## 5. 阶段四：Run 固定与 Executor 解耦 Registry

### 5.1 修改文件

- `apps/api/src/modules/ai/run/run.service.ts`
- `apps/api/src/infra/agent/agent-executor.ts`
- `apps/api/src/test/ai-agent-runs.test.ts`
- `apps/api/src/test/pi-agent-executor.test.ts`
- `apps/api/src/test/ai-cross-product-runtime.test.ts`
- 所有 Run snapshot 和 executor config fixture。

### 5.2 实施步骤

- [ ] `ResolvedAgentExecutorConfig` 删除 `toolNames`，增加必填 `tools`。
- [ ] 删除 Executor 的 `selectTools()` 和对 `PiAgentExecutorOptions.tools` 的运行期选择依赖；如果 options registry 仅剩无调用方则删除该字段。
- [ ] Run Service `buildSnapshot()` 写 `schemaVersion: 2` 和 `toolRefs`。
- [ ] Run Service prepare 时传 `tools: resolved.tools`。
- [ ] 更新 fake executor 和测试 helper 的类型。
- [ ] 增加测试：同一 Run prepare 后修改 Agent 配置或 Registry，不改变 captured config.tools。
- [ ] 增加测试：后续新 Run resolve 新 ref，使用新版本。
- [ ] 更新恢复测试的 snapshot fixture 为 v2；保留损坏 snapshot -> interrupted 的现有行为。
- [ ] 确认 snapshot JSON 不含 schema、handler、timeout、permission、arguments、result 或 secret marker。

### 5.3 局部验证

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-agent-runs.test.ts src/test/pi-agent-executor.test.ts src/test/ai-cross-product-runtime.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
```

### 5.4 回滚点

如果测试为了替换 Tool 需要直接改 Registry 内部 Map，改用两个独立 Registry/Agent revision fixture；不添加 registry mutation API。

## 6. 阶段五：Adapter 安全与 Principal 权限

### 6.1 修改文件

- `apps/api/src/infra/agent/pi-tool-adapter.ts`
- `apps/api/src/infra/agent/agent-executor.ts`
- `apps/api/src/modules/ai/ai.route.ts`
- `apps/api/src/test/pi-tool-adapter.test.ts`
- `apps/api/src/test/pi-agent-executor.test.ts`
- `apps/api/src/test/ai-principal-scope.test.ts` 或新增精确的 Product App Tool 权限测试。

### 6.2 实施步骤

- [ ] 把 permission port 改为基于 `PrincipalContext`，或在 Adapter 内按 principal kind 分流后才调用现有 repository。
- [ ] `starter_user` 使用 `principal.principalId` 查询权限。
- [ ] `product_app` 对非空 `requiredPermission` 直接 forbidden，不读取 Starter user role 表。
- [ ] 删除 Adapter options 的权限用途裸 `userId`；保留 Executor 其他审计所需 userId 时不得传入 handler。
- [ ] 实现安全 arguments 大小检查：不可序列化、非 object 或 JSON 字符数超过 16000 返回 invalid arguments。
- [ ] arguments 大小检查不能把值写入异常、日志、audit 或 test snapshot。
- [ ] Zod parse 后才调用 handler。
- [ ] `reportProgress` 始终注入函数；空摘要忽略，超过 1000 截断，modelText 为空。
- [ ] 继续校验 handler result：modelText <= 16000，safeSummary <= 1000。
- [ ] 测试 product_app externalUserId 等于现有 Starter user id 仍 forbidden。
- [ ] 测试权限查询抛错时 forbidden，不能放行。
- [ ] 测试超大、不可序列化、无效 schema、scope、permission、timeout、cancel、result 超限和原始异常不泄漏。

### 6.3 局部验证

```bash
pnpm --filter @starter/api exec vitest run src/test/pi-tool-adapter.test.ts src/test/pi-agent-executor.test.ts src/test/ai-principal-scope.test.ts --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
```

### 6.4 回滚点

如果 Product App 未来需要权限，不在本任务加产品角色表或 permission header。当前明确拒绝，后续另建任务。

## 7. 阶段六：Tool audit 版本和数据库 migration

### 7.1 修改文件

- `apps/api/src/modules/ai/ai.schema.ts`
- 新增 Drizzle migration 和 meta snapshot。
- `apps/api/src/modules/ai/usage-audit/usage-audit.repository.ts`
- `apps/api/src/modules/ai/usage-audit/usage-audit.service.ts`
- `apps/api/src/modules/ai/usage-audit/usage-audit.presenter.ts`
- `apps/api/src/infra/agent/pi-tool-adapter.ts`
- `apps/api/src/test/ai-usage-audit.test.ts`
- `apps/admin/src/features/ai/pages/AiUsage.tsx` 或实际审计详情组件。
- `apps/admin/src/test/ai-usage-audit.test.tsx`

### 7.2 实施步骤

- [ ] schema 增加 nullable `toolVersion` / `tool_version`。
- [ ] 使用 `pnpm --filter @starter/api db:generate` 生成 migration；不要手写已存在 migration。
- [ ] 检查 SQL 是简单 nullable `ALTER TABLE ADD COLUMN`，没有坏的表重建。
- [ ] begin audit input 增加 Tool version，新 Registered Tool 执行必须传精确版本。
- [ ] unknown Tool 的 audit version 可以 null；不得猜测当前最新版本。
- [ ] presenter 返回 nullable version。
- [ ] Admin 审计详情优先显示 `name@version`，null 只显示 name，不制造版本。
- [ ] 测试历史 null、新执行精确版本、幂等 finalize、恢复 interrupted 和字段白名单。
- [ ] 检查 DB 行、API DTO、SSE 和日志均不含 arguments/result/secret marker。

### 7.3 局部验证

```bash
pnpm --filter @starter/api db:generate
pnpm --filter @starter/api db:check
pnpm --filter @starter/api exec vitest run src/test/ai-usage-audit.test.ts --config vitest.config.ts
pnpm --filter @starter/admin exec vitest run src/test/ai-usage-audit.test.tsx --config vitest.config.ts
pnpm --filter @starter/api check-types
pnpm --filter @starter/admin check-types
```

### 7.4 回滚点

如果 drizzle-kit 生成重建表 migration，停止，不执行 migration。先检查 schema 是否误加 CHECK 或 NOT NULL；本设计要求 nullable 新列以保留历史 audit。

## 8. 阶段七：Admin Agent Tool Ref 表单

### 8.1 修改文件

- `apps/admin/src/features/ai/pages/Agents.tsx`
- `apps/admin/src/api/ai/agent.api.ts` 和 `agent.query.ts`，仅在类型链路要求时修改。
- `apps/admin/src/i18n/locales/zh.ts`
- `apps/admin/src/i18n/locales/en.ts`
- `apps/admin/src/test/ai-agents.test.tsx`
- `apps/admin/src/test/ai-management-pages.test.tsx`，如 Catalog 列表断言位于此处。

### 8.2 实施步骤

- [ ] 表单字段改为 Tool ref UI key 数组，不能复制一套 API DTO。
- [ ] 增加局部 `toolRefKey()` / `parseToolRefKey()`，使用合法 name/version 不可能包含的分隔符。
- [ ] `toConfig()` 写 `schemaVersion: 2` 和 `toolRefs`。
- [ ] `toFormValues()` 从结构化 refs 生成 key。
- [ ] Tool option label 显示 `name@version` 和 description；value 为稳定 key。
- [ ] 同名不同版本选择在表单提交前给出校验错误；服务端仍作为最终校验边界。
- [ ] 默认空值改为 `toolRefs: []`。
- [ ] 保持 Tool query loading/error/retry、mutation pending 和权限 guard。
- [ ] 更新中英文 i18n 文案，不能显示原始 key。
- [ ] 测试创建、编辑 round-trip、多个不同名 Tool、同名版本冲突、Catalog 加载失败和精确 payload。

### 8.3 局部验证

```bash
pnpm --filter @starter/contracts build
pnpm --filter @starter/admin exec vitest run src/test/ai-agents.test.tsx src/test/ai-management-pages.test.tsx --config vitest.config.ts
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
```

### 8.4 回滚点

不要通过 `as any` 或本地复制 `AgentDefinitionConfig` 绕过 contracts 类型。表单值可以不同，但转换必须显式。

## 9. 阶段八：全仓 fixture、文档和删除检查

### 9.1 实施步骤

- [ ] 搜索所有 `toolNames`；除历史 migration、归档任务或明确文档引用外，运行时代码和测试必须为零。
- [ ] 搜索 Agent/Run 的 `schemaVersion: 1`；运行时代码和 fixture 必须为零。
- [ ] 搜索 `find(` 调用，确认 Tool Registry 不存在无版本查找。
- [ ] 搜索 `selectTools`，确认 Executor 不再二次读取 Registry。
- [ ] 搜索 `userId` 与 Tool context，确认 handler context 不含裸 userId。
- [ ] 搜索 audit schema/DTO，确认 version 从 Adapter 到 DB 到 Admin 完整传递。
- [ ] 更新 `.trellis/spec/api/backend/ai-integration-guidelines.md`、`pi-agent-execution-guidelines.md`、`ai-system-design.md` 中已过时的 Tool 名称 allowlist、handler context 和审计说明。
- [ ] 如 Admin contracts 规则产生新的长期约束，更新对应 spec；不要把任务特有执行清单写进 spec。

### 9.2 敏感信息检查

用固定 marker 测试并搜索序列化结果：

```text
TOOL_ARGUMENT_SECRET_MARKER
TOOL_RESULT_SECRET_MARKER
TOOL_ERROR_SECRET_MARKER
```

断言它们不出现在：

- Admin/API response。
- HarnessEvent/SSE。
- Starter SQLite audit。
- logger sink。
- Run snapshot。

Pi 内部 tool result 允许包含受限 `modelText`，但公开 transcript DTO 不能返回原始 Tool result。

## 10. 最终质量检查

严格按以下顺序执行，前一项失败先修复再继续：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
git diff --check
```

还要运行任务聚焦测试：

```bash
pnpm --filter @starter/api exec vitest run \
  src/test/ai-test-tools.test.ts \
  src/test/ai-agent-definitions.test.ts \
  src/test/ai-agent-runs.test.ts \
  src/test/pi-tool-adapter.test.ts \
  src/test/pi-agent-executor.test.ts \
  src/test/ai-usage-audit.test.ts \
  src/test/ai-principal-scope.test.ts \
  src/test/ai-cross-product-runtime.test.ts \
  src/test/ai-harness-contracts.test.ts \
  --config vitest.config.ts

pnpm --filter @starter/admin exec vitest run \
  src/test/ai-agents.test.tsx \
  src/test/ai-usage-audit.test.tsx \
  src/test/ai-management-pages.test.tsx \
  --config vitest.config.ts
```

## 11. Review Gate

实施 Agent 完成后，主会话必须派发 `trellis-check` 做全范围检查。Check Agent 需要核对：

- PRD AC1-AC13。
- design 中的依赖方向和安全边界。
- `implement.md` 每个阶段是否完成。
- API、Contracts、Admin specs。
- migration SQL 和历史 null 行。
- v1 兼容代码是否完全删除。
- Product App 权限绕过是否真实封死。
- 敏感 marker 是否泄漏。

发现问题由 Check Agent 直接修复并重新运行检查。最终仍由主会话执行一次完整质量命令，更新 spec，再展示 commit 计划请求用户确认。
