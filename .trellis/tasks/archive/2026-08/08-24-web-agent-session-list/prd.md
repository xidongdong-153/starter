# Web 端 Agent 会话列表与切换、改名、归档

## Goal

让 Web（公开站点，验证 app）的对话页能看到自己的历史会话、在会话之间切换、改会话标题、归档不要的会话。
现在 Web 只能自动续上最近一条会话，用户既看不到别的会话，也回不到某一条旧对话。

## Background：已确认事实

API 侧能力已经齐全，本任务不改 `apps/api` 和 `packages/contracts`。

- `GET /api/ai/sessions?page&pageSize` 返回 `{ items, total, page, pageSize }`，`pageSize` 默认 20、上限 100（`packages/contracts/src/ai.ts:747`，路由 `apps/api/src/modules/ai/session/session.openapi.ts:52`）
- 列表只含未归档会话，排序 `updatedAt desc, id desc`（`apps/api/src/modules/ai/session/session.repository.ts:151`）
- `PATCH /api/ai/sessions/{sessionId}` 改 `title` / `defaultAgentId`，至少传一个字段（`session.openapi.ts:85`）；`title` 限制 trim 后 1-120 字符（`packages/contracts/src/ai.ts:716`）
- `DELETE /api/ai/sessions/{sessionId}` 是归档而不是删除，返回归档后的 session（`session.openapi.ts:112`，`session.service.ts:181`）
- 改名和归档只对未归档会话生效，命中不到返回 404
- transcript 支持 `cursor` + `direction` 翻页（`session.openapi.ts:129`）
- 鉴权走 `requireRuntimePrincipal`，Web 的 Better Auth cookie 即可，数据按 `ownerId` 隔离（`apps/api/src/modules/ai/principal.guard.ts`）

Web 侧现状：

- `getAgentSessions()` 已存在，固定请求 `page=1&pageSize=20`（`apps/web/lib/api/ai-chat.api.ts:35`）；`PATCH` 和 `DELETE` 还没有封装
- 启动时只取 `sessionList.items[0]` 读它的 transcript，没有任何会话列表 UI（`apps/web/hooks/use-chat-run.ts:95`）
- 首次发送时才创建会话，标题取输入前 40 字符（`use-chat-run.ts:270`，`TITLE_MAX_LENGTH = 40`）
- 会话状态集中在 `useChatRun`，`sessionId` 同时写 state 和 `sessionIdRef`，异步回调读 ref（`use-chat-run.ts:40`、`use-chat-run.ts:57`）
- Run 期间有 SSE 流和断流轮询两条异步链路，切换会话必须处理它们的作废
- 页面是单栏 `max-w-3xl` 容器（`apps/web/app/(site)/chat/page.tsx`）
- Web 只测协议层纯函数，没有 jsdom 和 React 测试环境（`apps/web/vitest.config.ts`）

## Key Decisions

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 列表形态 | 单栏对话区上方加会话区，下拉选择加新建、改名、归档按钮 | 不动 `(site)` 页面骨架，移动端不需要额外抽屉 |
| Run 运行中 | 禁用切换、新建、改名、归档，只留停止生成 | 避免 SSE 流和轮询两条链路交叉作废，是本任务最大风险点 |
| 列表容量 | 只取最近 20 条，`total > 20` 时提示共多少条 | 沿用现有请求参数，不引入翻页状态 |
| 新建会话 | 只清空本地引用和时间线，等首次发送再 POST | 复用现有创建逻辑，不产生空会话 |
| 归档确认 | 按钮内联二段确认（确认归档 / 取消） | Web 没有 Dialog 组件，不为此引入弹窗依赖 |
| 列表刷新 | Run 进终态后重新拉一次列表 | 自动标题和 `updatedAt` 排序由服务端决定，重拉最省心 |

## Requirements

- R1 会话区：对话区上方显示会话选择器，列出最近 20 条未归档会话的标题，当前会话为选中项；`total > 20` 时显示「共 N 个会话，只显示最近 20 个」。
- R2 切换：选中另一个会话后读它 main lane 最新一页 transcript 并替换时间线，切换期间显示加载提示，切换失败按 R9 处理。
- R3 新建：「新建对话」清空当前会话引用、时间线和运行视图，不发请求；首次发送创建成功后，新会话插入列表首位并选中。
- R4 改名：「改名」把当前会话标题切成输入框，保存调 `PATCH`，成功后更新列表标题；trim 后为空或超过 120 字符时前端拦截并提示，取消恢复原标题。
- R5 归档：「归档」二段确认后调 `DELETE`，成功后从列表移除；归档的是当前会话时切到列表首条并读它的 transcript，列表空则回到空态。
- R6 运行中禁用：`running` 为 true 时会话选择器和三个按钮全部 disabled，只有停止生成可用。
- R7 列表新鲜度：Run 进终态后重新拉取会话列表，让自动生成的标题和排序与服务端一致；拉取失败不清空已有列表，只提示。
- R8 无障碍：选择器有关联 label，按钮有可访问名称，会话操作的结果沿用现有 `aria-live` 提示区。
- R9 错误处理：401 提示重新登录，404 按「这个对话已经不存在」处理并清掉本地引用，其他错误显示接口 message；全部复用 `handleRequestError`。

## Acceptance Criteria

- [ ] 登录后打开 `/chat`，对话区上方出现会话选择器，选项是最近 20 条未归档会话，默认选中最近更新的一条，时间线显示它的历史。
- [ ] 会话数超过 20 时，会话区显示总数提示。
- [ ] 切换到另一个会话后，时间线换成该会话的历史；再切回来，内容与切走前一致。
- [ ] 点「新建对话」后时间线清空、选择器显示未保存的新对话，此时不产生网络请求；发送第一条消息后列表出现这条新会话并处于选中态。
- [ ] 改名保存后选择器里的标题立即变化，刷新页面仍是新标题；输入空标题或超过 120 字符时给出提示且不发请求。
- [ ] 归档当前会话后它从选择器消失，时间线切到剩下的最近一条会话；归档最后一条会话后回到空态文案。
- [ ] Run 运行中，选择器和新建、改名、归档按钮均不可点击，停止生成可用；Run 结束后恢复可用，并且列表标题和顺序与服务端一致。
- [ ] 归档接口返回 404 时提示「这个对话已经不存在」并从列表移除，不残留选中态。
- [ ] `pnpm --filter @starter/web test` 覆盖会话列表纯函数（选下一条、插入、移除、可操作判断）且通过。
- [ ] `pnpm --filter @starter/web check-types`、`pnpm --filter @starter/web lint`、`pnpm format:check` 全部通过。

## Out of Scope

- 已归档会话的查看与恢复（API 没有恢复接口）
- transcript 向上翻页、多 lane 视图
- `steer` / `follow-ups` 交互
- 会话搜索、置顶、分组、批量操作
- 通过 `PATCH` 设置会话级 `defaultAgentId`（Agent 选择继续留在输入区）
- 左右双栏或可折叠面板布局
- `apps/api`、`packages/contracts` 的任何改动
