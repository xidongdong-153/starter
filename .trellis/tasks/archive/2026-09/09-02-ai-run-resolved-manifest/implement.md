# 阶段B执行计划

## 步骤 1：契约与数据层

- [x] `packages/contracts/src/ai.ts`：`aiRunResolvedManifestSchema`（结构见 design.md 第 3 节）与 DTO 类型导出。
- [x] `ai.schema.ts`：四张新表（`ai_system_prompt_revisions`、`ai_skill_revisions`、`ai_run_resolved_manifests`、`ai_output_contract_snapshots`）+ 主表新列（prompt/skill 的 current_revision、Agent 的资源 revision 记录列、structured outputs 的 visibility/mode）。
- [x] `db:generate` 检查 migration SQL 与回填语句（design.md 第 8 节），`db:migrate` 执行（已应用到开发库，表已存在）。

## 步骤 2：canonical hash 工具与 registry 改造

- [x] 新建 `run/resolved-manifest.ts`：`canonicalJson`（键排序序列化）与 `sha256Hex`。
- [x] `tool-registry.ts`：注册时计算 manifestHash（含 z.toJSONSchema 的 inputSchema）。
- [x] `output-contract-registry.ts`：define 时经可选注入的 snapshotStore upsert 快照；`toStructuredOutputContractRef` 优先读表列、NULL 回退 registry。

## 步骤 3：资源 revision 链与传播

- [x] prompt/skill repository：update 走“INSERT revision 行 → UPDATE 主表 content+current_revision → bump 引用 Agent”单事务。
- [x] agent.service：create/update 记录当前资源 revision 列；resolve 返回全部资源 revision 与 content hash（按 Agent 行 pinned revision 读不可变 revision 行）。
- [x] 验证：资源内容更新后引用 Agent 的 revision +1；未引用的 Agent 不动（test 覆盖）。

## 步骤 4：manifest 生成与持久化

- [x] run.service：resolve 后组装 manifest（含内联 hash 与 `inline` 标记）、计算 manifestHash、INSERT manifest 表，失败走现有错误收尾释放 lease。
- [x] run.service 增加 `describeResolvedManifest(runId)` 内部 presenter（design 写 agent.service，实际放 run.service，见 .pi-plan.md 偏差记录）。

## 步骤 5：测试

- [x] 新增 `ai-resolved-manifest.test.ts`：
  - 相同 Agent revision 不同时间两次 Run → 相同 manifestHash。
  - Prompt 内容更新 → 资源 revision +1、引用 Agent revision +1、旧 Run manifest 不变。
  - 内联配置 Run：manifest 记录内联 hash，promptId/revision 为 null。
  - manifest 写入失败 → Run 启动失败并释放 lease。
  - contract 从 registry 移除后历史 structured output 仍可按快照渲染。
  - 另含：Skill content/description 传播、DTO 无 secret、Tool manifestHash 稳定。
- [x] 回归全量（441 个测试全过）。

## 步骤 6：收尾

- [x] 验证命令全绿：

```bash
pnpm --filter @starter/api check-types
pnpm --filter @starter/api lint
pnpm --filter @starter/api format:check
pnpm --filter @starter/api test
pnpm --filter @starter/api db:check
```

- [x] packages/contracts 改动后跑全仓 `pnpm check`（contracts 是共享包）。
- [x] trellis-check（主会话执行）。
- [x] spec 更新（agent-run-guidelines 或新文档：manifest 与 revision 不变量；主会话执行）。
- [x] 回到调研任务 implement.md 勾选阶段 B 条目；用户确认后提交。

## 回滚点

- 步骤 1-2 后：删新表列与 registry 改动。
- 步骤 3-4 后：还原 service/repository；revision 与 manifest 数据保留（只增事实）。
- 不保留"读取历史靠 registry、又靠快照"的两套主路径——回退时明确单一回退分支（NULL 回退仅限存量行）。
