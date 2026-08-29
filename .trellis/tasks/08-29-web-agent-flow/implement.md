# Web Agent Flow —— 执行清单

## 步骤

1. **依赖与脚手架**
   - `pnpm --filter @starter/web add @xyflow/react`（版本进 `pnpm-workspace.yaml` catalog）。
   - `app/(site)/flow/page.tsx` 页面 + 站点导航入口（chat 旁）；metadata 对齐 chat。
   - `globals.css` 或组件内引 `@xyflow/react/dist/style.css`。

2. **lib/flow 纯函数层**（design.md 第 2-5 节，先写测试再实现）
   - `flow-document.ts` + `flow-document.test.ts`：模型、localStorage 仓库（key `web-agent-flow/v1`）、导入导出。
   - `flow-validate.ts` + `flow-validate.test.ts`：单链校验、模板静态校验。
   - `flow-template.ts` + `flow-template.test.ts`：渲染规则。
   - `flow-run.ts` 状态机 + 测试（mock API）。

3. **API 薄封装**
   - `abortRun`、`listStructuredOutputs`、`readLaneTranscript` 补进 `lib/ai/run-event-stream.ts` 旁的合适位置（或独立文件），走 `apiRpc` + `unwrapApiData`，风格对齐现有代码。

4. **UI 组件**（`app/(site)/_components/flow/`）
   - `flow-workspace.tsx`：布局 + 状态装配（文档列表当前文档、选中节点）。
   - `flow-sidebar.tsx`：文档 CRUD 列表。
   - `flow-canvas.tsx` + 两个自定义节点 + 工具栏（运行/停止/导入/导出）。
   - `flow-inspector.tsx`：Agent 节点配置（agentId 下拉 + 模板 + 变量插入）、运行态产出/错误展示。
   - `hooks/use-flow-run.ts`：驱动器（建 Session、逐节点 startRunStream、终态判定、产出提取、停止/重试）。

5. **手动验收**（dev 环境，至少过一遍）
   - 两节点链端到端（B 引用 `{{steps.0.output}}`）。
   - 拓扑非法提示、模板非法提示。
   - 失败 + 从失败节点重试续跑；运行中停止。
   - 文档 CRUD、刷新持久化、导出再导入 roundtrip。
   - 未登录访问 `/flow` 显示登录提示。

6. **验证命令**
   ```bash
   pnpm check
   pnpm test
   pnpm build
   ```

7. **提交**（Conventional Commits）
   ```
   feat(web): add agent flow canvas with react flow
   ```

## 风险点

- React Flow v12 + Next.js 16 SSR/hydration：画布必须客户端渲染，出现 hydration 报错时用 `next/dynamic` 惰性加载画布组件。
- `@xyflow/react` 样式与 Tailwind 的 preflight 冲突：节点样式自定义类优先，必要时用 React Flow 的 CSS 变量。
- use-chat-run 的 resume 逻辑较复杂，flow 不要复用该 hook（它是 chat 单 Run 假设），只复用 lib 层函数。

## 回滚点

纯新增（一个页面 + 新目录 + 新依赖），单提交 revert 即可，不影响 chat 既有功能。
