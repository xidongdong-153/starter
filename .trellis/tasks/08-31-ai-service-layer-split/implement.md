# 实施计划：AI 服务层拆分与产品模块骨架

前置：design.md 已定稿。每个步骤完成即勾选，验证命令逐步执行。

## 步骤 1：services 层拆分

- [x] 新建 `apps/api/src/modules/ai/ai.services.ts`：从 `ai.route.ts` 搬入全部 service 组装 + 三个启动副作用，导出 `createAiServices` / `AiServices`。
- [x] `ai.route.ts` 改签名为 `createAiRoute(runtime, services)`，只留鉴权中间件与路由挂载。
- [x] `modules/ai/index.ts` 导出 `createAiServices`、`AiServices`。
- [x] 抽 `run/run-sse.ts`（`writeRunEventStream`），`run.route.ts` 两处替换。

验证：`pnpm --filter @starter/api check-types && pnpm --filter @starter/api test`
（此时 `routes/index.ts` 传 services，现有测试全绿即证明拆分无行为变化。）

## 步骤 2：chat 模块

- [x] `modules/chat/chat.openapi.ts`：agents、sessions CRUD、transcript、runs get/abort、active-run、runs POST（SSE+JSON 分流）、events/stream、attachments POST + content GET。
- [x] `modules/chat/chat.route.ts` + `index.ts`，注入 `AiServices`，鉴权 `requireAuth`。
- [x] `routes/index.ts` 注册 chat 路由（`createAiServices` 创建一次共用）。
- [x] middleware：body-limit 加 `/api/chat/attachments` POST 分支；secure-headers 加 `/api/chat/attachments/:id/content`。

验证：`pnpm --filter @starter/api check-types`；新增 `product-modules.smoke.test.ts` 的 chat 用例（同构对比 `/api/ai/agents`、sessions 全链路、401）。

## 步骤 3：flow 模块

- [x] `modules/flow/flow.openapi.ts` + `flow.route.ts` + `index.ts`：agents、sessions POST、transcript（lane）、runs POST、run get、abort、structured-outputs。
- [x] `routes/index.ts` 注册 flow 路由。

实现时修正（已同步进 design.md）：chat/flow 并入主 AppType 触发 TS7056（声明序列化上限），改为产品路由运行时挂载、类型不入 AppType，独立导出 `src/rpc/chat.ts`、`src/rpc/flow.ts`；产品面响应 data 用通用成功信封，请求 schema 保持精确。`pnpm --filter @starter/api build` 已验证（rpc.d.ts 1.16MB + 产品类型 104KB/63KB）。

验证：`pnpm --filter @starter/api test`（新增 flow 用例：sessions 创建、lane transcript、agents 同构对比）。

## 步骤 4：web 切换

- [x] 新建 `lib/api/chat.api.ts`、`lib/api/flow.api.ts`；删除 `lib/api/ai-chat.api.ts`。
- [x] `lib/api/ai-attachments.api.ts` → `chat-attachments.api.ts`，路径改 `/api/chat/attachments`。
- [x] `lib/ai/run-event-stream.ts` 加 `product` 分流（chatRpc / flowRpc）。
- [x] hooks（`use-chat-run`、`use-flow-run`、`use-chat-attachments`）与 `flow-workspace.tsx` 改 import。
- [x] 测试更新：`run-event-stream.test.ts` mock 改产品 client；`ai-attachments.test.ts` 改名 `chat-attachments.test.ts` 并改断言。

实现时修正：chat.route.ts 链尾的附件 content 普通 `.get()` 会把返回类型降级成 `HonoBase`，`rpc/chat.ts` 的 `extends OpenAPIHono<infer S>` 提取失败（ChatSchema=never，client 塔成 unknown）。改为语句式注册（丢弃返回值），已在代码内注释。

验证：
```bash
grep -rn "api/ai" apps/web/lib apps/web/hooks apps/web/app apps/web/test --include="*.ts" --include="*.tsx"
# 无输出
pnpm --filter @starter/web check-types && pnpm --filter @starter/web test
# 均通过（9 文件 82 用例）
```

## 步骤 5：收尾

- [x] 依赖方向检查：`grep -rn "modules/chat\|modules/flow" apps/api/src/modules/ai/` 无输出。
- [x] 全量检查：`pnpm check`（types + lint + format，6 任务全过）+ `pnpm --filter @starter/api test`（58 文件 411 用例）+ `pnpm --filter @starter/web test`（9 文件 82 用例）。
- [x] `pnpm --filter @starter/web build` 通过。
- [x] 手动冒烟（curl 级，dev 服务 + 临时用户）：chat/agents 与 ai/agents data 同构；session 创建/改名/归档/列表；附件上传→内容取回字节一致；SSE run 事件序列完整（run.started→turn→step→model_call→run 终态，model 上游 AI.UPSTREAM_ERROR 是 dev 环境未配真实模型凭证所致，不在本任务范围）；flow session 创建 + lane=main transcript；未登录 401；附件跨域 embed 头回显 Origin。页面级交互待用户确认。

## 回滚点

- 步骤 1 单独成立（纯重构，测试绿即可回滚整提交）。
- 步骤 2-4 依赖步骤 1；web 切换（步骤 4）完成后旧 `/api/ai/*` 仍在，前端可即时回退 import。
