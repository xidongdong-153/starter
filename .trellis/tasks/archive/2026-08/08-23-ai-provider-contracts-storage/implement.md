# Contracts 与数据库实现计划

1. [x] 读取 API backend、contracts backend/frontend 和 shared guides spec。
2. [x] 搜索现有 Provider DTO、错误码、schema、migration、repository 和模型引用清理逻辑。
3. [x] 设计并实现 `customAiProviderProtocolSchema`、definition、model、compat 和 mutation schemas。
4. [x] 设计 `ai_custom_providers` 表；确定 JSON 字段和 SQLite check/index。
5. [x] 生成 migration，运行 `db:check` 并检查 snapshot。
6. [x] 实现 repository 的 CAS、revision、list/find、delete transaction 和引用清理。
7. [x] 添加 schema、repository、migration safety 测试。
8. [x] 导出跨层类型并记录 Child 2/3 所需字段。
9. [x] 依次运行 type-check、lint、format、targeted tests。

风险点：`packages/contracts/src/ai.ts` 是跨端单一来源；数据库删除事务必须处理 enabled model、global default、catalog、provider config 和 Agent 引用，不能只删 definition。
