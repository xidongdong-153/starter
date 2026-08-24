# Admin 实现计划

1. [x] 读取 Admin frontend spec、contracts 类型和 Child 2 OpenAPI/RPC 定义。
2. [x] 拆分 `AiProviders.tsx` 中 Provider 表格、内置配置和 custom CRUD 交互的职责，避免继续扩大单组件复杂度。
3. [x] 增加 custom Provider API/query/mutation 和统一 cache invalidation。
4. [x] 实现创建/编辑表单，按 protocol 渲染 compat 字段，转换空值和模型数组。
5. [x] 实现模型维护表格或 Drawer，校验模型 ID、能力、上下文和成本。
6. [x] 实现 credential 保存、check、state、delete 和冲突提示。
7. [x] 增加中英文文案、权限隐藏、loading/error/empty/pending 状态。
8. [x] 添加 query/mutation 和关键表单转换测试，不测试 Antd 内部行为。
9. [x] 依次运行 Admin type-check、lint、format、targeted tests。

风险点：现有 `AiProviders.tsx` 同时承担 Provider 操作和模型白名单；改动要保持模型筛选、白名单和全局默认逻辑不回归，必要时拆出 custom Provider Drawer 组件。
