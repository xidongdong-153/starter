# 阶段 D 执行计划

父任务不直接启动实现。按顺序启动并归档三个子任务，最后回到父任务执行集成检查。

## 1. D1：Executable Manifest

- [ ] 完成 D1 的 `prd.md`、`design.md`、`implement.md` 和 context manifests。
- [ ] 用户审阅后启动 D1。
- [ ] 实现公开 Manifest、发现接口和期望 revision 校验。
- [ ] 运行 D1 的 contracts/API 检查与测试。
- [ ] 更新相关 spec，获得提交确认后提交并归档 D1。

回滚点：D1 不做 migration；删除新路由、schema 和 presenter即可恢复原行为。

## 2. D2：AgentRuntimePort

依赖 D1 已归档。

- [ ] 根据 D1 的最终契约细化 D2 规划文件。
- [ ] 提取窄 port 和 concrete adapter。
- [ ] 提取 Accept、初始 SSE 和恢复 SSE transport helper。
- [ ] 依次迁移 AI、chat、flow route，保持 URL 和 OpenAPI schema。
- [ ] 运行 port 静态边界、Accept 矩阵、SSE 恢复和产品同构测试。
- [ ] 更新相关 spec，获得提交确认后提交并归档 D2。

回滚点：每个产品 route 可单独切回现有 service 调用；不能保留两套都能决定运行规则的主路径。

## 3. D3：应用策略与事件交付

依赖 D1、D2 已归档。

- [ ] 根据 D1/D2 实际接口细化 D3 规划文件和 migration。
- [ ] 增加 strict capability policy、policy revision 和审计记录。
- [ ] 在统一 port 检查 Agent、精确 revision、controls 和副作用等级。
- [ ] 禁止 `product_app` 绕过 Agent capability 使用内联配置或 completion。
- [ ] 让终态 Webhook 携带 terminal event identity、结果引用和受限 correlation metadata。
- [ ] 修正 Webhook 复合扫描游标和多实例 delivery claim。
- [ ] 增加 SSE 非终态结束恢复 frame，并补齐 flow 恢复入口。
- [ ] 运行 policy、Webhook、SSE、跨 scope 和多实例测试。
- [ ] 更新相关 spec，获得提交确认后提交并归档 D3。

回滚点：先关闭新版 policy/transport 行为，再回滚调用入口；保留 migration 产生的历史 policy 和 delivery identity。

## 4. 父任务集成检查

- [ ] 读取三个子任务的最终 PRD、偏差记录和验证结果。
- [ ] 验证公开 Manifest、Runtime Port、policy、RunEvent、Webhook 和 SSE 使用同一版本与 identity 语义。
- [ ] 检查 chat/flow 没有重新导入 repository、Pi 类型或复制 policy 判断。
- [ ] 确认中间事件订阅、远程 Tool、workflow 和 LangGraph 没有进入阶段 D。
- [ ] 运行：

```bash
pnpm check
pnpm test
pnpm build
```

- [ ] 检查 Git diff 只包含阶段 D 和 Trellis/spec 记录。
- [ ] 获得提交确认后提交父任务记录并归档。
