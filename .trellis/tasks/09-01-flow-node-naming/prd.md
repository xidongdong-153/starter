# PRD：Flow Agent 节点自定义命名

## 背景

Flow 画布的 Agent 节点标题显示 `Agent 1`、`Agent 2`……这个编号来自链上位置（`stepIndex`），运行时算出来，不落存储。节点换位置编号就变，画布上多个节点时无法看出各自职责；运行前校验报错也只说"第 N 个 Agent 节点"，定位不到具体节点。

用户确认做破坏性改造：`FlowAgentNodeData` 的 `name` 字段必填，不做旧数据迁移，接受旧文档被丢弃。

## 目标

1. Agent 节点带可编辑的名称，持久化在 Flow 文档里（localStorage）。
2. 画布节点标题、Inspector 面板标题显示节点名称。
3. 运行前校验的错误消息用节点名称定位报错节点。
4. 内置模板的节点直接配语义化名称（如"提炼要点"、"翻译成简报"）。

## 非目标

- 不改 `packages/contracts` 和 `apps/api`：节点名是纯前端文档属性，`startRun` 请求不携带。
- 不做名称唯一性校验（允许重名）。
- 不做节点重命名的撤销/历史。
- 不迁移旧 localStorage 文档、不做旧格式 JSON 导入兼容（破坏性，已确认）。
- 不给输入节点加名称（输入节点全文档只有一个，无定位需求）。

## 验收标准

### 数据结构

1. `apps/web/lib/flow/flow-document.ts` 的 `FlowAgentNodeData` 增加 `name: string` 必填字段；`flowAgentNodeDataSchema` 同步为 `z.string().trim().max(60)`，允许空串。
2. 文档内所有创建 agent 节点的路径都写入 `name`：`createFlowDocument`、`duplicateFlowDocument`（复制保留原名）、`parseFlowImport`（随 schema 校验）、`flow-canvas.tsx` 的快捷追加和工具栏新增、`flow-templates.ts` 的模板节点。
3. 旧 localStorage 文档（节点无 `name` 字段）加载时 schema 校验失败，`createFlowDocumentRepository.load()` 返回空列表，页面回到空文档列表，不报错。

### 展示与编辑

4. 画布节点标题（`flow-node-agent.tsx`）：`name` 非空时显示名称，空串时回落现状的 `Agent ${stepIndex + 1}`（无链上序号时只显示 `Agent`）。
5. Inspector 面板（`flow-inspector.tsx`）：头部标题同步节点名称；面板内提供名称输入框，输入即时写回文档（经由 `flow-workspace.tsx` 的新增更新回调）。
6. 内置模板 6 个 agent 节点配语义化名称：文章模板（提炼要点、英文简报）、代码模板（代码审查、重构与测试）、头脑风暴模板（发散方案、方案细化）。

### 校验与报错

7. `flow-validate.ts` 的错误消息标注节点：有名称时用「节点"XXX"」，无名称时维持「第 N 个 Agent 节点」。

### 测试与质量

8. `apps/web/test/flow-document.test.ts` 补：`name` 缺失的文档被丢弃、带 `name` 的文档正常解析、`name` 超 60 字符被拒绝、复制保留名称。
9. `apps/web/test/flow-validate.test.ts` 补：有名称节点的报错消息包含名称。
10. `pnpm check` 和 `pnpm test` 通过。

## 约束

- 破坏性改动范围仅限 web 前端的 localStorage 数据；模板变量语法（`{{input}}`、`{{steps.N.output}}`）与运行链路不动。
- 名称长度上限 60 字符，与节点卡片的紧凑展示匹配；文档名维持现状 120 上限，两者独立。
- 空串是合法值：新节点默认空串，UI 回落显示序号，不在保存时强制填名。
