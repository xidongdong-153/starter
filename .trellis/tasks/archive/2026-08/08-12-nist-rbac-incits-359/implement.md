# 执行计划：NIST RBAC 职责分离（SSD）落地

## 实施顺序

### 第 1 步：调研报告（先行）

- [x] 撰写 `research/nist-rbac-incits-359.md`：
  - INCITS 359 三层结构与正式元素（Core / Hierarchical / Constrained，UA / PA / Sessions / RH / SSD / DSD）。
  - 标准元素 → 当前脚手架映射表（已实现 / 本次落地 / 不做 + 理由）。
  - SSD 语义选择说明（互斥组 vs 冲突角色集、独占角色表达）。
  - DSD / Hierarchical / cardinality 不做的理由与未来引入条件。
  - 外部结论标注来源，无法核验的写成待确认项。

### 第 2 步：契约（packages/contracts）

- [x] `src/index.ts` 新增 `ExclusiveRoleGroups` 常量（含 `[RoleKeys.ADMIN]` 独占组）。
- [x] `ApiErrorCodes` 新增 `AUTH_ROLE_CONFLICT: 'AUTH.ROLE_CONFLICT'`。

### 第 3 步：API 校验（apps/api）

- [x] `authorization.repository.ts`：新增互斥校验纯函数（输入 roleKeys，输出冲突组或 null）；`replaceUserRoles` 幂等短路后插入校验，新增 result kind `exclusive-role-group-conflict`。
- [x] `authorization.service.ts`：映射 `exclusive-role-group-conflict` → 403 `AUTH.ROLE_CONFLICT`，中文文案按 `xdd-plain-docs` 规范。
- [x] OpenAPI 403 response：`replaceUserRoles` 已声明通用 403（`forbiddenResponse`），错误码不逐字面量枚举，无需文件改动。

### 第 4 步：测试（apps/api）

- [x] smoke test 覆盖：`[admin, operator]` 拒绝且角色不变；`[admin]` 成功；`[operator, viewer]` 成功；幂等提交成功；存量违规不扫描不自动改。

### 第 5 步：质量门禁

- [x] `pnpm check`（types → lint → format，全零错误）。
- [x] `pnpm test`（API smoke tests 全绿，含新增用例）。

## 验证命令

```bash
pnpm --filter @starter/api db:check        # 无 schema 变更，确认 migration 状态未变
pnpm check
pnpm test
```

## 风险点与回滚

- 无 migration、无 schema 变更，回滚 = 移除第 2/3/4 步改动。
- 若预置互斥组未来与真实业务冲突（如需要 admin 与其他角色共存），修改 `ExclusiveRoleGroups` 常量即可，不影响数据。
- `bootstrapAdminByEmail` 写入路径需确认不触发互斥校验或天然满足约束（目标集 `[admin]` 单角色）。

## 完成标准

- 调研报告完成且来源可核验。
- `replaceUserRoles` 违反互斥组时返回 403 `AUTH.ROLE_CONFLICT`，用户角色不被修改。
- 现有非互斥分配、幂等提交、admin 独占均按预期工作。
- `pnpm check` 与 `pnpm test` 全绿。
