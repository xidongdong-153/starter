# AI 运行资源 Scope 实施计划

## 阶段 1：scope 查询接口

- [x] 统一 Session/Run repository 的 scope 参数和返回错误。
- [x] 写跨 scope fixture：不同 project、不同 app、不同 externalUserId。
- [x] 保留 Starter owner adapter，并让现有路由行为不变。

## 阶段 2：数据库和迁移

- [x] 为 Session 增加 scope columns，并让 Run 通过 Session scope 做归属检查。
- [x] 为 Session scope 查询增加 tenant/project/externalUser/status 索引。
- [x] migration 将旧 Session 明确回填为 `starter_user + starter/starter + ownerId`。

## 阶段 3：Session/Run 接入

- [x] Session create/list/get/update/archive/transcript 全部带 scope。
- [x] Run start/get/abort/steer/follow-up、live snapshot 全部带 scope。
- [x] Pi Session ID 只用于存储定位，授权先通过主库 Session scope。

## 阶段 4：依赖资源和审计

- [x] Agent resolve 校验平台资源状态和 revision，并接收运行 `ResourceScope`。
- [x] Prompt/Skill 引用按平台资源状态校验；Tool 引用按运行 scope 校验。
- [x] Model/tool audit 查询按 scope 过滤，保留敏感信息过滤。

> 首版 Agent/Prompt/Skill 是 Starter 控制面平台资源，不伪造 tenant/project 归属；运行时仍在 Agent snapshot 解析阶段强制校验状态、revision 和 Tool scope。

## Verification

```bash
pnpm --filter @starter/api exec vitest run src/test/ai-agent-sessions.test.ts src/test/ai-agent-runs.test.ts src/test/run-live-snapshot.test.ts --config vitest.config.ts
pnpm --filter @starter/api exec vitest run src/test/ai-harness-migration.test.ts src/test/ai-destructive-migration.test.ts --config vitest.config.ts
pnpm --filter @starter/api db:check
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
```

## Rollback

- 迁移前保存旧 schema 和 fixture；scope 查询可以通过 compatibility adapter 回退。
- 不删除 owner 字段，除非所有 Starter 兼容测试和 product app 验收已经通过。
- 如果资源表迁移无法安全确定旧数据归属，停止在 migration 阶段，不用默认 scope 继续运行。
