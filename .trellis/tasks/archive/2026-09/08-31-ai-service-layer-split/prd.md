# PRD：AI 服务层拆分与产品模块骨架

## 背景

`apps/api/src/modules/ai` 是一套设计中立的产品无关 AI 运行时，但 `ai.route.ts` 把全部 service 组装成私有变量后直接挂 HTTP 路由，外部无法进程内调用。同时 chat 和 flow 的产品逻辑全部写在 web 前端，直接调 `/api/ai/*`。

目标架构：`modules/ai` 保持中立 HTTP + service 层；产品模块（`modules/chat`、`modules/flow`）进程内调用 AI service，拥有自己的 HTTP 面；依赖单向：产品模块可以 import AI 模块，AI 模块禁止 import 产品模块。

## 本轮范围

四件事，全部做完才算完成：

### 1. 服务层拆分

把 `apps/api/src/modules/ai/ai.route.ts` 的组装逻辑拆成两层：

- `createAiServices(...)`：创建全部 service（run、session、completion、agent、configuration、prompt、skill、attachment、usage-audit、webhook、application），返回 service 集合。
- `createAiRoute(services)`：只做 HTTP 挂载和 OpenAPI 声明，不再创建任何 service。

service 集合从 `modules/ai/index.ts` 导出，类型和实现都可供产品模块进程内调用。现有 `/api/ai/*` 路由行为不变。

### 2. 产品模块骨架（薄代理）

新建 `apps/api/src/modules/chat` 和 `apps/api/src/modules/flow`，各含：

- 路由组：`/api/chat/*`、`/api/flow/*`，鉴权走 `requireAuth`（starter_user）。
- 行为要求：转发到 AI service 层的调用结果与现在 web 直调 `/api/ai/*` 完全等价，同一份契约 schema（`packages/contracts`）。
- 不带产品语义：不新增 DTO 形状、不建业务表、不改响应结构。产品逻辑后续迭代再收进来。

路由覆盖范围以 web 前端实际用到的 AI 端点为准，开工前先盘点 `apps/web/lib/api/ai-chat.api.ts`、`ai-attachments.api.ts` 和 flow-workspace 的调用清单，逐个映射。

### 3. web 前端全量切换

chat、flow 两个页面所有 AI 调用全部改走 `/api/chat/*`、`/api/flow/*`。`/api/ai/*` 对 web 不再被直接调用，但接口保留对外开放（product_app + Bearer 路径不受影响）。

### 4. 扩展注入点保持空置

`createRuntime` 的 `aiTools`、`aiOutputContracts` 注入点不动，本轮不注册任何产品 tool 或 output contract。

## 不做的事

- 不建 `flow_canvases` / `flow_nodes` 业务表。
- 不给 `aiAgentDefinitions` 加 scope 列（Agent 产品隔离下一轮）。
- 不把 AI 模块抽成独立 package。
- 不动用户系统、权限体系。
- 不改 `/api/ai/*` 现有契约和行为。

## 完成标准

1. `pnpm check-types`、`pnpm lint`、`pnpm format:check` 全部通过。
2. `pnpm test`（apps/api 现有测试）全部通过；现有测试不改断言语义，只允许改 import 路径。
3. web 的 chat 和 flow 页面功能与切换前等价：会话创建、Run 启动、SSE 事件流、transcript 读取、附件上传、Agent 列表。
4. 代码中出现 `/api/ai/` 字面量的 web 源码文件为零（`apps/web` 下 grep 不到）。
5. `modules/ai` 的 import 列表中不出现 `modules/chat` 或 `modules/flow`（依赖单向可检查）。
6. 薄代理端点与对应 `/api/ai/*` 端点返回同构数据（同一契约 schema 校验通过）。

## 风险与边界

- `ai.route.ts` 组装逻辑里有副作用（webhook dispatcher 启动、session 一致性检查、run 恢复扫描），拆分时这些副作用必须保持原有触发时机，不能丢也不能重复执行。
- web 直调 `/api/ai/*` 的调用点数量需要开工前盘点确认，以盘点结果为准，不凭记忆估计。
