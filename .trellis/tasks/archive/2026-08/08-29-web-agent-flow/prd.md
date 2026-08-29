# Web Agent Flow 可视化编排

## Goal

在 Web 端（apps/web）新增 `/flow` 页面：用 React Flow（`@xyflow/react`）画布把 Agent 节点拖放连线成流程，填起点输入后逐节点执行，节点上实时显示运行状态，可查看每步产出。流程定义存本地（localStorage + JSON 导入导出），执行完全在客户端驱动，后端零改动。

## 已确认决策

1. **执行模型：客户端编排**。页面内逐节点调原子 Run API（startRun → SSE 到 terminal → 提取产出 → 渲染下一步模板），页面关闭流程即停。与 API 原子化方向一致（08-28-ai-atomic-runtime：平台不内嵌编排）。
2. **存储：localStorage + 导入导出 JSON**。多文档管理（新建/复制/重命名/删除），导出为 JSON 文件，导入时校验。无后端存储。
3. **节点能力 MVP：线性链**。一个输入节点 + N 个 Agent 节点串联；模板变量 `{{input}}` 和 `{{steps.N.output}}`（沿用已删除的 pipeline 模板语义）；不支持分支、并行、循环。

## Requirements

### 画布与文档管理

- `/flow` 页面挂在 `(site)` 布局，与 `/chat` 平级，站点导航加入口；登录门禁与 chat 相同（未登录显示登录提示，Run/Agent API 都是 cookie 鉴权）。
- 左侧流程列表 sidebar（仿 chat-session-sidebar 模式）：文档名、更新时间，新建/复制/重命名/删除。
- 右侧 React Flow 画布：添加「输入节点」「Agent 节点」，拖拽摆放、连线、删除；节点位置持久化。
- 选中 Agent 节点时侧边配置面板：agentId 下拉（`GET /api/ai/agents` enabled 列表，复用 use-chat-run 的取数方式）+ promptTemplate 文本域 + 可用变量插入（`{{input}}`、`{{steps.N.output}}`）。
- 画布工具栏：运行、停止、导入、导出、文档名编辑。
- 运行前校验：图必须是从输入节点出发的单链（每节点至多一入一出、无环、无不可达 Agent 节点），不满足给出可读错误；模板静态校验（步骤 i 只能引用 N < i 的产出，规则与旧 pipeline `validateStepTemplates` 相同）。

### 执行引擎（客户端）

- 点运行：弹出起点输入框（或输入节点内填写），创建新 Agent Session（title `Flow: <文档名>`）。
- 逐节点执行：渲染模板 → `startRun`（SSE 模式，lane 用 `flow-<节点在链上的序号>` 隔离 transcript，幂等键 `flowRunId-节点序号` 保证重试安全）→ 等 terminal → 提取产出 → 下一节点。
- 产出提取：结构化输出优先（`GET runs/{runId}/structured-outputs`），无则读该 lane transcript 最后一条 assistant 文本（复用 chat 的 transcript 读取方式）。
- 节点状态画布实时显示：idle / running（进行中样式）/ completed / failed；点击节点侧边面板查看产出全文与错误信息。
- fail fast：节点失败停止推进，已跑节点状态与产出保留；支持「从失败节点重试」（复用上游缓存产出，新建幂等键继续）。
- 停止按钮：abort 当前 Run + 停止推进，链状态标 aborted。
- 刷新/关闭页面：本次运行中断（Session 与已跑 Run 留在服务端，可通过 chat 页查看该 Session）；重新运行 = 新 Session 从头跑。

## Acceptance Criteria

- [ ] `/flow` 登录后可用；未登录显示登录提示；导航有入口。
- [ ] 文档 CRUD + localStorage 持久化（刷新不丢）+ 导出 JSON / 导入 JSON（非法文件报错不落库）。
- [ ] 画布可添加/连线/删除节点；非法拓扑（环、分叉、多输入节点）运行前拦截并提示。
- [ ] 两节点链端到端跑通：输入 → Agent A → Agent B（B 的模板引用 `{{steps.0.output}}`），两节点依次 running → completed，产出正确串联。
- [ ] 节点失败：链停止、错误可见、从失败节点重试成功续跑。
- [ ] 运行中停止：当前 Run aborted，后续节点不启动。
- [ ] 纯函数层（文档校验、模板渲染、执行状态机）有 vitest 单测；`pnpm check`、`pnpm test`、`pnpm build` 全绿。

## Out of Scope

- 分支、并行、循环节点（后续迭代）。
- 流程定义后端存储与多端同步。
- 后端任何改动（contracts / api 不动）。
- 流程运行历史记录（刷新后画布运行态不恢复，只留服务端 Session）。
- 移动端画布适配（桌面优先，小屏给出降级提示即可）。
