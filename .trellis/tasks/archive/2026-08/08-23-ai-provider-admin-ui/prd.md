# Admin 自定义 Provider 管理界面

## Goal

在现有 `/ai/providers` 管理页中提供自定义 Provider 的完整管理流程，并保持内置 Provider 配置和模型白名单体验不回归。

## Scope

- `apps/admin/src/api/ai/ai.api.ts`、`ai.query.ts`、相关 mutation。
- `apps/admin/src/features/ai/pages/AiProviders.tsx` 及必要的 feature components。
- 中英文 i18n、权限、交互测试和响应式布局。
- 不修改 API runtime 和数据库。

## Requirements

- 只有 `AI_CONFIG_MANAGE` 用户能看到创建、编辑、保存、检查、启停和删除动作；读取权限仍按现有 Provider 页面规则。
- 创建表单支持三类协议，协议变化时只显示对应 compat 字段。
- Base URL、模型列表、能力、成本和凭据字段按 contracts 类型提交。
- API Key 输入只能写入请求，不能回显；保存后只显示 mask/status。
- 更新后明确显示“需要重新检查”，不假设 Provider 仍然可用。
- 自定义 Provider 不显示内置 Provider 的删除动作；内置配置流程继续可用。
- 删除必须二次确认；引用冲突显示 API 安全错误，不伪造成功。
- 覆盖 loading、error、empty、pending、success、权限和窄视口状态。
- 不在页面直接拼接数据库字段或 API URL；请求函数和 query 放在 `api/ai/`。

## Acceptance Criteria

- [ ] 管理员可以创建三类协议的 custom Provider。
- [ ] 管理员可以编辑基础配置、compat、凭据和模型列表。
- [ ] 管理员可以检查认证、启停和删除 custom Provider。
- [ ] Provider 列表能区分内置和自定义 Provider。
- [ ] API 错误、冲突、权限和 pending 状态可见且文案准确。
- [ ] 中英文文案齐全，布局在窄视口不截断关键操作。
- [ ] Admin type-check、lint、format 和测试通过。

## Dependencies

- 依赖 Child 1 的 contracts DTO。
- 依赖 Child 2 的 OpenAPI/RPC endpoint 和错误码。
- Child 4 在本任务完成后验证真实 API 数据流。

## Verification

```bash
pnpm --filter @starter/admin check-types
pnpm --filter @starter/admin lint
pnpm --filter @starter/admin format:check
pnpm --filter @starter/admin test -- src/test/ai-custom-provider.test.tsx
```
