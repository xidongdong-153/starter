# 实现计划

## 执行顺序

### 1. 父任务准备

- [x] 确认生产 URL 网络策略：HTTPS 公网或命中 API 环境变量 CIDR allowlist 的私网地址；Admin 不能修改 allowlist。
- [x] 确认协议范围：`openai-completions`、`openai-responses`、`anthropic-messages`，模型由 Admin 手工维护。
- [x] 所有子任务完成后执行父任务集成检查，不在父任务重复实现子任务代码。

### 2. Child 1：contracts 与数据库

- [x] 在 `packages/contracts/src/ai.ts` 增加 custom Provider kind、protocol、compat、model definition、create/update/delete/check DTO。
- [x] 为 URL、Provider ID、模型 ID、模型能力、成本和协议兼容字段增加严格 schema。
- [x] 在 `apps/api/src/modules/ai/ai.schema.ts` 增加 `ai_custom_providers` 表、索引和 JSON check。
- [x] 生成并检查 Drizzle migration；确认既有内置 Provider 行和 Pi Session DB 不受影响。
- [x] 增加 definition repository，处理 revision/CAS、列表、详情、删除和模型引用清理。
- [x] 增加 contracts/repository 单元测试。
- [x] 验证 `pnpm --filter @starter/api db:check`、contracts type-check、相关测试。

### 3. Child 2：API runtime 与控制面

- [x] 读取 Child 1 的 contracts/schema，不重新定义跨层 payload。
- [x] 将 runtime 的 `builtinModels()` 重构为可追加自定义 Provider 的 mutable Models 集合。
- [x] 实现固定 protocol -> `pi-ai` API implementation 的穷举工厂。
- [x] 实现静态手工模型转换和协议兼容字段转换。
- [x] 实现启动恢复、定义校验失败隔离、创建/更新热加载、删除卸载。
- [x] 复用现有 CredentialStore、ModelsStore、认证状态机、配置 revision 和错误归一化。
- [x] 实现 URL guard、DNS/IP 校验、redirect 策略、timeout 和响应大小限制。
- [x] 增加 custom Provider CRUD、credential、check、state、models 路由、service、repository、presenter、OpenAPI。
- [x] 合并统一 Provider 列表 DTO，增加 `kind` 等兼容字段。
- [x] 覆盖三种协议的 fake stream、权限、错误码、secret 过滤、引用清理和热加载测试。
- [x] 依次运行 API type-check、lint、format、targeted tests。

### 4. Child 3：Admin UI

- [x] 读取 Child 2 的 OpenAPI/RPC 类型和错误码，不手写 API payload 类型。
- [x] 扩展 `apps/admin/src/api/ai/ai.api.ts`、`ai.query.ts` 和 mutation cache invalidation。
- [x] 在 Provider 页面增加新建 custom Provider 入口、编辑表单、协议选择、兼容字段和模型管理。
- [x] 保留内置 Provider 既有配置入口，避免误把 built-in 当 custom 删除。
- [x] 增加凭据保存、认证检查、启停、删除和引用冲突提示。
- [x] 增加中文/英文文案，遵循 `xdd-plain-docs`，不在 UI 暴露 secret。
- [x] 增加 loading、error、empty、pending、权限和表单转换测试。
- [x] 依次运行 Admin type-check、lint、format、targeted tests。

### 5. Child 4：跨层验证

- [x] 检查 contracts -> OpenAPI -> RPC -> query -> page 字段一致性。
- [x] 检查 custom Provider 在启动、保存、check、enable、model allowlist、default model、model test、Agent Run、usage audit 中的完整数据流。
- [x] 验证三类协议各一条成功路径和 auth/timeout/upstream 失败路径。
- [x] 验证 SSRF、secret、redirect、非法模型、删除引用和并发 revision。
- [x] 验证 Admin 权限和普通用户模型可见性。
- [x] 执行全量质量门禁和 build。
- [x] 必要时回退到 Child 1/2/3 修复契约，不在验证任务中留临时兼容代码。

### 6. 父任务收尾

- [x] 更新 `.trellis/spec/api/backend/ai-integration-guidelines.md`，记录自定义 Provider 的 runtime、安全和测试规则。
- [x] 更新相关 Admin spec，记录 custom Provider 页面和权限边界。
- [x] 重新读取 PRD、design、implement，确认没有未解决阻塞项。
- [x] 按仓库规则向用户展示改动摘要，等待明确确认后再提交，不自动 commit。

## 验证命令

```bash
pnpm --filter @starter/contracts check-types
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/api db:check
pnpm test
pnpm build
pnpm check
```

## 风险文件

- `apps/api/src/infra/ai/ai-runtime.ts`：影响所有内置 Provider、模型测试和 Agent Run。
- `apps/api/src/infra/ai/ai-provider-registry.ts`：Provider 定义合并和 ID 冲突。
- `apps/api/src/infra/ai/ai-gateway.ts`、`pi-native-stream.ts`：三类协议 stream 适配和错误归一化。
- `apps/api/src/modules/ai/ai.schema.ts` 与 migrations：数据库结构和删除事务。
- `packages/contracts/src/ai.ts`：跨端单一协议来源。
- `apps/admin/src/features/ai/pages/AiProviders.tsx`：已有 Provider 配置和模型白名单页面。

## 回滚点

- Child 1 完成 migration 后：只新增表，未接入 runtime 时可停留在数据库层。
- Child 2 runtime 工厂接入前：保留旧 `builtinModels` 创建路径作为未提交的局部变更，不增加兼容分支到最终代码。
- Child 2 API 接入前：可只通过 runtime fake 测试验证工厂。
- Child 3 UI 接入前：API 可通过 OpenAPI/smoke 测试验证。
- 集成验证失败时：按失败边界回退到对应子任务，不修改无关模块。
