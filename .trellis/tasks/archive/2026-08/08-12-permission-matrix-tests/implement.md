# Implement：权限矩阵测试（BOLA/BFLA 表驱动测试）

## 执行步骤

1. [x] 读取 `.trellis/workflow.md`、`get_context.py` 输出、`index.md` 开发前检查清单
     与 `authorization-guidelines.md`（已完成，见上文上下文）。
2. [x] 编写 `apps/api/src/test/permission-matrix.smoke.test.ts`：
     - 2.1 beforeAll：createTestApp、注册 5 个用户、bootstrap admin、
         创建 `matrix-control` 自定义角色并关联 powerUser、上传 fileA/fileB。
     - 2.2 定义 `MatrixCase` 表 + 驱动函数 + 四个用例段（files / profile 头像 /
         控制面 / admin 特权独立用例）。
     - 2.3 afterAll：cleanup。
3. [x] 单跑新测试文件：
     `pnpm --filter @starter/api test permission-matrix`（vitest 文件名过滤）。
     预期全部通过；失败时按用例名定位修复。
4. [x] 全量 `pnpm test`（确认未破坏既有 8 个 smoke test 文件）。
5. [x] 全量门禁 `pnpm check`（types → lint → format，零错误）。
6. [x] 更新 spec：把「表驱动矩阵」作为 smoke test 检查项写入
     `authorization-guidelines.md` 的 Tests Required 段（若有价值且简短）。
7. [ ] git commit（Conventional Commits，scope=api，subject 英文短句）。
     注：implement 子代理禁止 git commit，由主会话执行。

## 验证命令

```bash
pnpm --filter @starter/api test permission-matrix   # 新文件单跑
pnpm test                                           # 全量 API 测试
pnpm check                                          # types + lint + format
```

## 完成标准

- 新测试文件通过，且矩阵用例数 >= 40（files ~24 + profile ~6 + 控制面 ~30 去重后）。
- 验收标准 1-7 全部满足（对照 prd.md）。
- `pnpm check` 与 `pnpm test` 全绿。
- 产品代码零改动（git diff 仅新增一个测试文件 + 可选 spec 更新）。

## 回滚点

- 提交前：删除新测试文件即可恢复原状。
- 提交后：`git revert` 单提交，产品代码无风险。
