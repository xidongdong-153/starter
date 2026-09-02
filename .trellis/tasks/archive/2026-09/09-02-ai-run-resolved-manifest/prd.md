# 阶段B：不可变资源版本与 resolved manifest

## Goal

历史 Run 能证明当时实际使用的模型、Prompt、Skill、Tool 和 Output Contract：资源有不可变 revision，Run 启动时固化 resolved manifest，后续资源修改不改变旧 Run 的解析结果。

任务来源：`.trellis/tasks/09-02-api-ai-agent-architecture-research/implement.md` 阶段 B。依赖阶段 A（`09-02-ai-run-durable-lease`）完成。

## Requirements（来自调研路线，启动前细化为验收标准）

- Prompt 与 Skill 增加不可变 revision；编辑创建新 revision，不原地覆盖。
- Agent Revision 固定引用资源 revision，不只引用可变 ID。
- Tool manifest 与 Output Contract schema 生成稳定 hash。
- Run 启动时生成 `ResolvedRunManifest` 并在进入 executor 前持久化（结构见调研任务 design.md 第 4 节）。
- 敏感 Prompt 的保存方式：加密内容或受控历史表；不能只保存无法还原的 hash。
- 历史结构化输出读取不依赖当前进程仍注册同名 contract。
- 只读 manifest presenter：去除 secret、完整 Prompt 与内部 handler 信息。
- 验证：资源后续修改不改变旧 Run 的 manifest 与读取结果；相同 Agent revision 不同时间解析出相同 manifest hash。

## Out Of Scope

- 不做 attempt / step / 副作用策略（阶段 C）。
- 不做第三方 manifest 公开接口（阶段 D）。
- 不做远程 Tool。

## Acceptance Criteria

- [x] migration 生成并执行：四张新表、主表新列、存量回填（每个 prompt/skill 生成 revision 1；Agent 资源 revision 记录回填；structured outputs 新列保持 NULL）。（0029_nasty_phalanx.sql，已应用到开发库）
- [x] 相同 Agent revision 在不同时间启动两次 Run，解析出相同 `manifestHash`（集成测试断言）。
- [x] Prompt/Skill 内容更新：资源 revision +1、引用它的 Agent revision +1、未引用的 Agent 不变；旧 Run 的 manifest 与历史输出读取结果不变。
- [x] 内联配置 Run 的 manifest：`inline: true`、content 为内联文本 SHA-256、promptId/revision 为 null；内联全文不落库。
- [x] manifest 写入失败时 Run 启动失败并释放 lease，不存在无 manifest 的 starting/running Run。（触发器注入失败，断言 failed 终态、lease 释放、可重试）
- [x] Tool 注册后可置出稳定 manifestHash；相同定义重复注册 hash 不变。
- [x] Output Contract 从代码中移除后，历史 structured output 仍可按快照渲染（visibility/mode 取表内值）。
- [x] `describeResolvedManifest(runId)` 返回的 DTO 无 secret、无 Prompt 正文、无 handler 信息。（实现在 run.service，见偏差记录）
- [x] `pnpm --filter @starter/api` 四项质量命令全过；`packages/contracts` 改动后全仓 `pnpm check` 全过。（441 个测试全过）
- [x] `db:generate` / `db:check` / `db:migrate` 通过。（generate 无漂移）

## Notes

- 设计决策与表结构见 `design.md`；执行清单见 `implement.md`。
- 关键决策已定：revision 表为事实源、主表 content 为镜像；资源更新时传播 Agent revision；内联 Prompt 只存 hash。
