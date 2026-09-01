# PRD：Flow 模板编辑器变量标签显示节点名称

## 背景

节点命名功能（archive/2026-09/09-01-flow-node-naming）给 Agent 节点加了可编辑名称，画布标题、Inspector 标题、校验报错三处已显示名称。漏了第四处：Prompt 模板编辑器（`flow-prompt-editor.tsx`）的变量胶囊和键入 `{` 的联想下拉，标签仍按链上序号现算为「Agent N 产出」（第 72 行）。用户把上游节点改名为「编程」后，下游节点模板编辑器里还是「Agent 1 产出」，名称形同虚设。

## 目标

模板编辑器的变量标签优先显示上游节点的名称，让「这个变量取自哪个节点」一眼可读。

## 非目标

- 不改变量语法本身（`{{input}}`、`{{steps.N.output}}` 不动，插入的文本不变）。
- 不改画布、Inspector 标题、校验报错的现有名称显示。
- 不给编辑器的联想过滤逻辑加按名称搜索之外的新能力（现有 filter 已同时匹配 variable/label/description，标签改名后自动生效）。

## 验收标准

1. `flow-prompt-editor.tsx` 删除从未使用的死 prop `agentNames?: Map<string, string>`。
2. `FlowPromptEditorProps` 新增 `stepNames?: string[]`（按链上序号排列的上游节点名称，序号即数组下标）。
3. 变量标签：`{{steps.N.output}}` 对应上游节点有非空名称时显示「XXX 产出」（XXX 为该节点名称），名称为空或 `stepNames` 缺失时维持「Agent N+1 产出」。
4. 变量描述同步：有名称时描述为「节点"XXX"的最终生成结果」，无名称维持「第 N 步节点的最终生成结果」。
5. `flow-inspector.tsx` 新增 `stepNames` prop 并透传给 `FlowPromptEditor`。
6. `flow-workspace.tsx` 从 `graph.chain.steps` 生成 `stepNames`（`step.node.data.name.trim()`，按链序号排列）传入 Inspector；graph 不 ok 时不传（回落序号显示）。
7. `pnpm --filter @starter/web check-types`、`lint`、`format:check`、`test` 全部通过。

## 约束

- 纯展示改动，不落文档存储，不改 `flow-document.ts` 及任何数据结构。
- 模板编辑器当前无组件测试，本次不新建测试文件（标签是组件内联逻辑，抽纯函数属于过度设计）；`stepNames` 生成逻辑在 `flow-workspace.tsx` 内联 useMemo，与 `chainIndex` 同款做法。
- 注释文案遵守 xdd-plain-docs（中文短句、无 emoji）。
