# AI 配置与模型选择执行计划

## 1. 任务拆分决定

本任务保持一个端到端 Trellis 任务，不创建 parent/child：

- API adapter、contracts、权限、Admin 和 SSE 必须共同验证同一组 Provider/model 复合 ID 和错误码。
- 单独完成某一层不能满足任何主要用户验收条件。
- 执行按下面的检查点分阶段；前一阶段通过后再进入下一阶段。

若实现过程中第三方 SDK adapter 无法满足固定 Provider 目录、credential 持久化或 stream 取消，回到 planning 修订 PRD/design，不用子任务掩盖依赖问题。

## 2. 执行顺序

### 2.1 依赖、Node 与 contracts

- [ ] 在 `pnpm-workspace.yaml` catalog 精确加入 `@earendil-works/pi-ai@0.84.1` 和 `eventsource-parser@4.0.0`。
- [ ] `apps/api/package.json` 添加 `@earendil-works/pi-ai`；`apps/admin/package.json` 添加 `eventsource-parser`；更新 lockfile。
- [ ] 根 `package.json` Node engine 收紧到 `>=22.19.0`，同步 README 中的环境要求。
- [ ] `apps/api/src/shared/env.ts` 增加可选 `AI_CREDENTIAL_ENCRYPTION_KEY` 和有界的 `AI_REQUEST_TIMEOUT_MS`；校验 base64 密钥解码后必须正好 32 字节。
- [ ] `apps/api/.env.example` 增加服务端变量和具体格式；Web/Admin 示例不出现加密密钥。
- [ ] 新增 `packages/contracts/src/ai.ts`，定义模型复合 ID、Admin DTO、用户 DTO、输入 schema、SSE event 联合及其 Zod schema。
- [ ] 在 `packages/contracts/src/common.ts` 增加 AI error code，在 `authorization.ts` 增加 `AI_CONFIG_READ/MANAGE`，在 `index.ts` 导出 AI 契约。
- [ ] 所有输入 schema 明确 trim、长度、集合上限和 nullable；Admin/user DTO 不复用包含管理员字段的基础 interface。

检查点：contracts build/type-check 通过；API/Admin 仍能解析根入口；没有任何 contracts 文件导入 `pi-ai`。

### 2.2 Drizzle schema、migration 与加密

- [ ] 创建 `apps/api/src/modules/ai/ai.schema.ts` 的五张表、复合主键、外键、check constraint 和必要索引。
- [ ] 在 `apps/api/src/infra/db/schema/index.ts` 导出并展开 AI schema。
- [ ] 实现版本化 AES-256-GCM payload，覆盖随机 IV、auth tag、错误密钥、损坏密文和缺少主密钥。
- [ ] encrypted payload 同时保存可选 credential 与 runtime settings；credential hint 单独按固定规则生成。
- [ ] 生成 Drizzle migration，并在 migration 中插入 `ai:config:read`、`ai:config:manage` permission。
- [ ] 更新授权 smoke test 对 permission 目录、admin 全权限和 operator/viewer 默认权限的断言。
- [ ] 测试环境注入固定测试密钥；测试 migration 继续使用独立临时 SQLite，不接触 `apps/api/data/app.db`。

检查点：`db:check` 通过；临时库从空库执行全部 migration；五张表约束和两条 permission 可查询。

回滚点：migration 或加密字段 all-or-none 约束不成立时停止，不继续写 Store 和 HTTP。

### 2.3 `CredentialStore` 与 `ModelsStore`

- [ ] 实现 `AiCredentialStore.read/list/modify/delete`，遵守 `modify(undefined)` 保留当前 credential 的 SDK 语义。
- [ ] 每个 Provider 使用进程内 Promise queue；异步 callback 结束后使用短 transaction 和 `row_version` CAS。
- [ ] CAS 冲突不覆盖新值，转换为稳定、可重试的 credential conflict。
- [ ] OAuth refresh 只递增 `row_version`；Admin/运维主动修改才递增 `config_revision`、清空 checked revision 并强制停用。
- [ ] `delete()` 保留 runtime settings；credential 被清除后允许 SDK 回到 ambient auth。
- [ ] 实现 `AiModelsStore.read/write/delete`，完整保存 models、checkedAt、lastModified、etag。
- [ ] ModelsStore 读取 JSON 时做 adapter 内部校验；损坏 cache 不进入 SDK，也不输出原始内容。
- [ ] 所有 Store 操作响应 `AbortSignal`。

检查点：加密 round-trip、同 Provider 串行、不同 Provider 并行、CAS 冲突、delete、OAuth refresh revision 和完整 ModelsStoreEntry 恢复测试通过。

### 2.4 Provider registry、runtime 与 gateway

- [ ] 创建固定 Provider registry：从 SDK Provider 派生基础元数据，普通 API Key 共用字段定义，特殊 Provider 通过 typed override map 补充。
- [ ] override 定义认证边界、Admin 字段、credential env 映射、runtime settings、状态说明和动态刷新能力，最终覆盖 `pi-ai@0.84.1` 的全部 40 个内置文本 Provider。
- [ ] 明确 Bedrock bearer token、AWS ambient、Vertex API Key/ADC、Cloudflare 多字段、Azure 参数、OAuth 和 Radius 动态 endpoint 的转换。
- [ ] 添加 registry 契约测试，断言 registry IDs 与 `builtinModels().getProviders()` 完全相等，且 `ImagesModels` 不在列表。
- [ ] 实现 `AiRuntime.ensureReady()`：memoized、在 AI route 首次调用时执行 `models.refresh({ allowNetwork: false })`，不把全局 `createRuntime()` 改成 async。
- [ ] catalog/密文恢复错误按 Provider 隔离；一个 Provider 出错不能阻止其他 Provider 或非 AI API。
- [ ] 对带 factory runtime settings 的 Provider 用相同 ID 重新 `setProvider()`；配置更新时中止旧 refresh 并替换单个实例。
- [ ] 实现主动 catalog refresh，检查 `{ aborted, errors }`，只在成功后重校验白名单/default。
- [ ] 实现 `AiGateway` 项目接口、timeout/abort 合并、stream event 消费和 `ModelsError` 映射。
- [ ] gateway 忽略 thinking/toolcall 内容，不把 SDK message/cause 交给客户端或全局 logger。
- [ ] 新增 API 运维命令 `ai:auth` 和 logout，用隐藏 prompt/Provider OAuth interaction；成功后标记 `needs_check` 并停用。

检查点：使用根入口导出的 `fauxProvider` 或注入 gateway 验证 runtime、动态恢复、文本 delta、done、error、timeout 和 abort，不调用付费 Provider。

回滚点：若必须从 `compat` 导入，或 SDK 类型无法限制在 `infra/ai`，回到 design 重新评估依赖，不继续扩散类型。

### 2.5 AI service、repository、presenter 与 route

- [ ] 实现 Provider config upsert、clear credential、check、enable/disable 和 refresh 状态迁移。
- [ ] config 更新在一个事务中替换 payload、递增 config revision、设置 `needs_check`、强制停用并清理失效全局默认。
- [ ] check 使用 `AI_CONFIG_MANAGE`，只保存规范化 auth status/source/error code；允许 OAuth refresh，但不持久化 SDK 原始 message。
- [ ] enable 要求 ready 且 checked revision 等于 current revision；失败返回 409。
- [ ] 实现管理员 catalog、白名单整体替换和全局默认设置；输入按复合 ID 去重并限制数量；catalog response 合并已失效白名单/default 引用并标明原因。
- [ ] 实现用户模型目录和 preference get/update/clear，所有查询按当前用户隔离。
- [ ] 实现统一模型选择：显式无效直接拒绝；用户接口把未知、停用和未进白名单统一成 `AI.MODEL_NOT_ALLOWED`；未显式指定时用户默认失效再回退全局默认。
- [ ] 在调用 gateway 前按当前数据库 revision、Provider 状态、catalog 和白名单再校验一次。
- [ ] 创建全部 JSON OpenAPI route 和 response；注册 `createAiRoute()` 并保持 `AppRpcType` 不泄漏 Node/SDK 类型。
- [ ] 实现 `POST /api/ai/test`：stream 前 JSON error，stream 后 SSE error；设置 no-cache、heartbeat、proxy buffering 和 abort cleanup。
- [ ] 管理员接口按 `AI_CONFIG_READ/MANAGE` 分开 middleware；用户接口只要求有效 session。
- [ ] presenter 分别构建 Admin/user DTO；自动测试遍历 JSON 响应确认不含 credential、token、env value、文件路径和 runtime endpoint。

检查点：API smoke tests 覆盖 200/400/401/403/404/409/503/504 与 SSE 终止事件，OpenAPI smoke test和 RPC type probe 通过。

### 2.6 Admin 请求层、权限和页面

- [ ] 创建 `apps/admin/src/api/ai/ai.api.ts`、`ai.query.ts` 和稳定 Query keys。
- [ ] JSON 请求使用 `apiRpc`/`unwrapApiData`；SSE 请求复用 `fetchApi` 的 URL、cookie、401/403 listener 和 JSON 错误解析。
- [ ] 调整 `fetchApi`：调用方 signal 主动取消时保留 `AbortError`，其余网络失败继续转为 `ApiRequestError(0)`；补共享请求测试。
- [ ] 使用 `eventsource-parser` 解析任意 chunk 边界的 SSE；每个 JSON payload 通过 contracts Zod schema 后再进入组件状态，未知/损坏 event 安全忽略。
- [ ] 创建 `/settings/ai` 用户设置页：selected/effective/source、清除偏好、模型测试、停止和重试。
- [ ] 创建 `/settings/ai/providers` 管理页：Provider 表格、状态筛选、配置 Drawer、auth check、启停、clear、catalog refresh、白名单和全局默认。
- [ ] Provider 配置页 route record 使用 `AI_CONFIG_READ`；所有写动作使用 `PermissionGuard(AI_CONFIG_MANAGE)`。
- [ ] 更新 route records、settings 导航顺序、标签栏过滤和中英文 i18n。
- [ ] API Key write-only：查询返回 mask，表单不回填，成功/关闭后 reset fields。
- [ ] model test 用 request generation ID 防止旧 stream 写入新结果；卸载、停止和再次发送都会 abort 前一个请求。
- [ ] 页面覆盖 loading、error、empty、pending、401、403、409、provider error、timeout、stream abort 和重试。
- [ ] 检查 375px 移动端、桌面和宽屏：长 Provider/model ID 换行或表格横向滚动，页面本身不出现横向溢出。

检查点：Admin 组件/Query/权限测试通过；浏览器验证菜单、直接 URL、保存配置、模型选择和流式输出。

### 2.7 集成与安全审查

- [ ] 用临时 SQLite 和 fake Provider 运行完整路径：Admin API → service → encrypted Store → runtime → SSE → Admin parser。
- [ ] 测试 credential 更新后旧值不能用于新请求；停用/clear/白名单变化立即阻止新请求。
- [ ] 测试动态目录成功、失败、abort、模型消失以及全局默认清理。
- [ ] 测试用户 A/B preference 隔离、失效用户默认回退和显式非法模型不回退。
- [ ] 在测试 logger sink 和响应 body 中搜索预置假 key、OAuth token、prompt、response、env 值和文件路径，必须无匹配。
- [ ] 可用本地真实 API Key 时只做一次手工 Provider smoke；没有外部凭据不阻塞任务完成，但在最终报告注明未验证真实上游。
- [ ] 使用 `ego-browser` 验证 Admin 桌面/移动视图、权限角色、SSE 停止和错误重试。

## 3. 测试矩阵

### Store 与 runtime

- 缺少/错误/正确加密密钥。
- payload tamper、字段缺失、旧 encryption version。
- 同 Provider 两个 modify、modify 与 delete、API 与 CLI CAS 冲突。
- OAuth refresh 不改变 config revision 或 enabled。
- ModelsStoreEntry 四类字段 round-trip。
- `allowNetwork:false` 只恢复 cache；主动 refresh 的 success/error/aborted。
- registry 精确覆盖 40 个文本 Provider，图片 Provider 不出现。

### 业务规则

- 未配置 → 保存 → 待检查 → ready-disabled → enabled。
- config 更新强制停用；启用未检查 revision 返回 409。
- disable 保留配置；clear 后 stored credential 不再遮蔽 ambient auth。
- 白名单 replace、重复项、未知 Provider、未知 model、失效 catalog model。
- 显式模型无效直接 403/404；用户默认失效回退全局；都无效返回稳定 code。
- 用户 preference 读取、更新、清除和跨用户隔离。

### HTTP 与 SSE

- Admin read/manage 权限矩阵、session 401、permission 403。
- 所有 Admin JSON response 只含脱敏字段。
- stream 前 JSON validation/auth/model error。
- stream 后 start/text_delta/done/error、timeout、browser abort、heartbeat。
- chunk 在 event/data/UTF-8 字符中间断开时 Admin parser 仍正确。
- 主动停止保留 AbortError，不显示“API 服务连不上”；真实网络失败仍显示连接错误。
- 连续两次发送时第一次结果不能覆盖第二次。

### Admin

- route record、导航、标签栏和直接 URL 权限。
- Query key 分层及成功/失败 mutation invalidation。
- Provider 列表/Drawer、模型表格、偏好页的 loading/error/empty/pending。
- API Key 不回填、不持久化、关闭后清空。
- 长 Provider/model ID、移动 Drawer、表格滚动和 SSE 长文本。

## 4. 主要文件范围

预计新增或修改：

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `package.json`
- `README.md`
- `apps/api/package.json`
- `apps/api/.env.example`
- `apps/api/src/shared/env.ts`
- `apps/api/src/bootstrap/create-runtime.ts`
- `apps/api/src/infra/ai/**`
- `apps/api/src/modules/ai/**`
- `apps/api/src/infra/db/schema/index.ts`
- `apps/api/src/infra/db/migrations/**`
- `apps/api/src/routes/index.ts`
- `apps/api/src/scripts/**ai**`
- `apps/api/src/test/**`
- `packages/contracts/src/ai.ts`
- `packages/contracts/src/common.ts`
- `packages/contracts/src/authorization.ts`
- `packages/contracts/src/index.ts`
- `apps/admin/package.json`
- `apps/admin/src/api/http.ts`
- `apps/admin/src/api/ai/**`
- `apps/admin/src/features/ai/**`
- `apps/admin/src/app/router/records.ts`
- `apps/admin/src/i18n/locales/zh.ts`
- `apps/admin/src/i18n/locales/en.ts`
- `apps/admin/src/test/**ai**`

`apps/admin/src/app/navigation/navigation.ts` 只有新增分组或现有 route record 不能表达顺序时才改。Web 不消费本期 AI 接口，不修改 `apps/web` 产品代码。

不修改 `/Users/wuwanzhu/Code/pi`；它只作为固定 commit 的源码证据。

## 5. 验证命令

迁移创建阶段：

```bash
pnpm --filter @starter/api db:generate
pnpm --filter @starter/api db:check
```

不直接用默认 `apps/api/data/app.db` 验证 migration。API tests 通过临时 SQLite 执行完整 migration；需要命令行验证时显式传临时 `DATABASE_PATH`。

最终质量检查严格按顺序执行：

```bash
pnpm check-types
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm --filter @starter/api db:check
```

定位失败时先按 contracts → API → Admin 的依赖顺序执行包级检查；修复前一项后再继续下一项。

## 6. 完成门槛

- [ ] `prd.md`、`design.md`、`implement.md` 已由用户审阅并明确同意进入实现。
- [ ] `implement.jsonl` 和 `check.jsonl` 均已替换示例项，包含实际规范和研究文件。
- [ ] 只有在独立批准后运行 `task.py start`；批准规划不等于批准 commit。
- [ ] Provider registry 与固定 SDK 的 40 个文本 Provider 完全一致。
- [ ] 类型、Lint、Format、API/Admin tests、build、migration check 全部通过。
- [ ] fake credential、prompt 和 response 不出现在 API response、Admin storage、构建产物和日志。
- [ ] 浏览器桌面/移动与权限矩阵已验收；真实上游未验证时明确记录。
- [ ] 提交前展示改动摘要并获得用户明确确认，不擅自 commit 或 push。
