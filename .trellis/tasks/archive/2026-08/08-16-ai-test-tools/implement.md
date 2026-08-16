# Implement: 测试用 AI 工具注册

## 实施清单

1. [x] 新建 `apps/api/src/modules/ai/test-tools.ts`：7 个测试工具（echo/get_current_time/add_numbers/random_number/fail_tool/slow_tool/admin_secret），导出 `createTestAiTools()`。
2. [x] `apps/api/src/bootstrap/create-runtime.ts`：读 `AI_TEST_TOOLS_ENABLED`，为 true 时并入测试工具；`deps.aiTools` 优先。
3. [x] `apps/api/.env.example` + `.env.development`：加 `AI_TEST_TOOLS_ENABLED=true` 及注释。
4. [x] 新增 `apps/api/src/test/ai-test-tools.test.ts`：注册/成功/参数校验/失败/超时/权限/审计用例。
5. [x] `pnpm --filter @starter/api test`（或 pnpm test）跑测试。
6. [x] `pnpm check`（types/lint/format）。
7. [ ] dev 对话手动验证（有模型 key 时）：触发 echo 或 get_current_time，确认 ai_tool_executions 有记录。——**待真实环境验证（与 parent 其他子任务统一验证）**

## 验证命令

```bash
pnpm --filter @starter/api test
pnpm check
```

## 风险文件

- `apps/api/src/bootstrap/create-runtime.ts`（注册点，改动小）
- `apps/api/src/modules/ai/ai-tool-registry.ts`（只读，不改）

## 完成标准

- 测试全绿（新增用例覆盖成功/校验失败/执行失败/超时/权限/审计）
- `pnpm check` 全绿
- 不配置 env 时注册表仍为空
