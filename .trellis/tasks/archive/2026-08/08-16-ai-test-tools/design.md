# Design: 测试用 AI 工具注册

## 1. 架构

测试工具与业务工具无差别，走同一链路：`defineAiTool` 定义 → `createAiToolRegistry` 注册 → orchestrator 执行 → 审计。

```
create-runtime.ts
  AI_TEST_TOOLS_ENABLED === "true"
    ? createAiToolRegistry([...createTestAiTools()])
    : createAiToolRegistry([])
```

- 工具定义放 `apps/api/src/modules/ai/test-tools.ts`，导出 `createTestAiTools(): RegisteredAiTool[]`。
- 注册点只有 `create-runtime.ts` 一处；`deps.aiTools`（测试注入）优先，不被 env 开关覆盖。
- 安全：工具结果只含安全文本；不输出 secrets、路径、环境变量。

## 2. 工具清单

| 工具 | inputSchema | execute 行为 | 验证点 |
|---|---|---|---|
| `echo` | `{ text: string(1..1000) }` | 返回 `text: ${text}` | 参数解析、结果回传 |
| `get_current_time` | `{}` | 返回 ISO 时间 | 无参数工具 |
| `add_numbers` | `{ a: number, b: number }` | 返回两数和 | 数值参数、zod 校验 |
| `random_number` | `{ min: int, max: int }` 且 min<=max | 返回范围随机数 | 范围/边界校验 |
| `fail_tool` | `{}` | 抛 Error | 失败路径、审计 failed |
| `slow_tool` | `{ seconds: number(1..10) }` | 等待 seconds 后返回 | 超时/取消路径（timeoutMs 设小） |
| `admin_secret` | `{}` | 返回固定字符串 | requiredPermission=ai:config:manage，权限拒绝路径 |

约定：

- `slow_tool.timeoutMs = 3000`（小于等待时间时可测超时；测试里直接断言 orchestrator 行为）。
- `fail_tool` 抛错 → orchestrator 捕获 → activity status=failed。
- 所有工具 `safeSummary` 返回与 modelText 一致的简短安全文本。

## 3. env 开关

- `AI_TEST_TOOLS_ENABLED`：字符串 "true" 启用（与现有 env 约定一致，用 `env.AI_TEST_TOOLS_ENABLED === "true"`）。
- `.env.example` 加注释行 `# 测试用 AI 工具开关（仅开发/测试环境开启）` + `AI_TEST_TOOLS_ENABLED=true`。
- `.env.development` 同步加 `AI_TEST_TOOLS_ENABLED=true`。

## 4. 测试策略

在 `apps/api/src/test/ai-tools.test.ts` 已有框架上扩展或新增 `ai-test-tools.test.ts`：

- 注册：`createTestAiTools()` 返回 7 个工具，name 合法、schema 为 object。
- 执行成功：echo/get_current_time/add_numbers/random_number 通过 fake registry 直接 execute 断言结果。
- 参数校验：random_number min>max、echo 超长 → orchestrator invalid_arguments。
- 失败路径：fail_tool → activity status=failed，errorCode=AI_TOOL_FAILED，审计 finalize 状态。
- 超时路径：slow_tool + 短 generation 时限 → timed_out。
- 权限路径：admin_secret + 无权限用户 → forbidden，审计状态 forbidden。
- 开关：create-runtime 层面（env 不配时注册表为空）——通过 `createRuntime` 的 env 模拟或单测 createTestAiTools 存在性。

测试沿用现有 `createTestApp` + fake gateway/orchestrator 模式（参考 ai-tools.test.ts 现有用例）。

## 5. 兼容与回滚

- 无表、无迁移、无 API 变更，纯新增文件 + runtime 注册逻辑。
- 不配置 env 时行为与现状完全一致（空注册表）。
- 回滚：删除 test-tools.ts 引用即可，无数据影响。
