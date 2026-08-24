# 完善 API 内置 AI Tool Catalog

## Goal

在不拆分独立 Tool package、不引入动态 Tool 或远程 Tool 的前提下，完善 `apps/api` 内置 AI Tool 的定义、注册、版本引用、Run 固定、执行安全和审计设计。管理员只能从 API 部署时注册的 Tool Catalog 中选择精确版本，不能创建、上传或修改 Tool handler。

完成后，同名 Tool 可以在 API 中保留多个版本，但单个 Agent 只能引用其中一个精确版本；Run 启动后持有当时解析出的 Tool 定义，不受 Agent 后续修改影响。

## Background

当前 API 已实现 `defineAiTool`、`AiToolRegistry`、Pi Tool Adapter、Zod 参数解析、scope、权限、timeout、取消、进度、安全结果和审计。现有主要缺口如下：

- Agent Definition 和 Run snapshot 只保存 `toolNames: string[]`，没有固定 Tool 版本。
- Registry 允许注册同名不同版本，但无版本查找会返回第一个匹配项。
- Executor 按名称从当前 Registry 再次筛选 Tool，无法从类型上保证 Run 使用 Agent Service 已解析的版本。
- 内置 Tool 在 `create-runtime.ts` 和 `ai.route.ts` 两处组装，Catalog 入口不统一。
- Tool execution audit 记录 Tool 名称，但没有记录版本。
- Product App 的权限主体不能安全复用 Starter User 的 `user_roles.userId` 查询；新增生产权限 Tool 前必须修正。

## Requirements

### R1. API 内置管理

- 所有 Tool contract、Catalog、业务 Tool 实现和执行 runtime 都保留在 `apps/api`。
- 不新增独立 Tool package。
- Tool handler 只能随 API 源码部署，不能通过 Admin、HTTP 请求、数据库记录、脚本内容或动态 import 注册。
- 不增加可编辑 Tool 数据表；代码中的 Catalog 是 Tool 定义的唯一来源。

### R2. Tool 定义

每个注册 Tool 必须声明：

- `name`
- 精确 `version`
- `description`
- object 类型的 Zod `inputSchema`
- `timeoutMs`
- `scope`
- `requiredPermission`
- `execute`

定义校验继续限制名称、语义版本格式、描述长度、100-30000ms timeout、有效 scope、有效权限和 object schema。结果继续限制 `modelText` 与 `safeSummary` 长度。

### R3. 精确版本引用

- Agent Definition 使用结构化 `toolRefs: Array<{ name; version }>`，不再把 `toolNames` 作为新配置的执行引用。
- Registry 只通过精确 `{ name, version }` 查找执行 Tool，不提供隐式“取任意版本”路径。
- 同一 Agent 不允许重复引用同一个 `name@version`。
- 同一 Agent 不允许同时引用同名不同版本，因为 Pi 模型调用只携带 Tool name。
- Admin Tool 选择器必须显示并提交精确版本。

### R4. Run 固定

- Agent Service 在 Run 开始前解析精确 Tool refs，并返回 `RegisteredAiTool[]`。
- Run Service 把已解析的 Tool 定义直接传给 Executor。
- Executor 不再根据 Tool 名称重新查询 Registry。
- Run snapshot 只保存无代码的精确 Tool refs，不保存 handler、Zod schema、参数、结果或 secret。
- 进程重启后仍按现有规则把未完成 Run 标记为 `interrupted`，不尝试从 snapshot 恢复函数。

### R5. Catalog 与模块边界

- API 提供一个明确的内置 Tool Catalog 组装入口。
- Tool 实现留在拥有其业务数据和 service 的模块，例如 `skill/skill-tools.ts`。
- Catalog 负责显式汇总已审核 Tool；不扫描目录。
- Tool 通过受控 service/repository 接口访问业务数据，不获取 Hono Context、Better Auth session、完整 runtime、Provider secret 或 Run/Session 主库写入口。
- 现有 `read_skill` 和测试 Tool 纳入统一 Catalog，测试 Tool 继续受 `AI_TEST_TOOLS_ENABLED` 控制。

### R6. 执行安全

Pi Tool Adapter 继续作为唯一执行安全边界，并覆盖：

- Tool 存在性与精确版本来源。
- arguments 可安全序列化且序列化后最多 16000 字符；超限或不可序列化按参数无效处理。
- Zod 参数解析。
- Resource scope 检查。
- 基于 Principal 类型的权限检查。
- Tool timeout 与 Run 剩余时间。
- AbortSignal 和用户取消。
- 最多 1000 字符的安全进度摘要。
- 安全错误码和给模型的固定失败结果。
- 所有已 begin 的审计都 finalize，重复 finalize 不覆盖第一终态。

Tool handler 只能收到已解析参数、`PrincipalContext`、`ResourceScope`、`requestId`、`AbortSignal` 和进度函数。类型定义中的这些执行上下文不再使用可选字段，也不额外暴露可与 Principal 混淆的裸 `userId`。

### R7. Product App 权限主体

- `starter_user` 的 Tool 权限可查询 Starter 用户角色。
- `product_app` 不得把 `externalUserId` 或 `principalId` 当作 Starter User ID 查询 `user_roles`。
- 第一版对带 `requiredPermission` 的 Product App Tool 调用采用明确拒绝，除非后续另建任务定义产品侧权限模型。
- 权限查询异常继续按拒绝处理。

### R8. 审计和公开输出

- 已注册 Tool 的新 execution audit 保存 `toolName` 和精确 `toolVersion`；未注册 Tool 的 `not_found` 审计允许 `toolVersion=null`，不得猜测版本。
- Admin Tool Catalog 只返回公开元数据，不返回 Zod schema、handler 或其他 runtime 对象。
- Admin/API/SSE/日志/主数据库不得出现 Tool arguments、原始结果、原始异常或 secret。
- Pi transcript 只保存继续模型循环所需的受限 Tool result；公开 transcript DTO 不返回 arguments 和原始 Tool result。

### R9. Admin 配置

- Agent 编辑页从 Catalog 加载 `name`、`version`、`description`、`scope` 等公开元数据。
- Tool 选择控件以 `name@version` 区分选项，并转换为结构化 `toolRefs` 提交。
- Admin 不能新增、编辑、删除、启停 Tool Catalog 条目，也不能修改 schema、timeout、scope 或权限。

### R10. 破坏性 schema v2

- Agent Definition config 和 Run snapshot 直接升级到 `schemaVersion: 2`。
- schema v2 只接受 `toolRefs`，不接受 `toolNames`。
- 不提供 v1/v2 union、转换函数、默认版本推断、读取回退或写入兼容。
- 不迁移现有 v1 Agent Definition 和 Run snapshot；开发环境需要删除并重新创建旧 Agent 数据。
- 读取到 v1 或其他损坏 JSON 时继续走现有安全内部错误，不把原始 JSON 返回客户端。
- Tool audit 的历史记录与 Agent config 兼容无关；数据库新增版本列时保留历史记录，旧记录和未注册 Tool 的 `not_found` 记录允许版本为 `null`，已注册 Tool 的新记录必须写入精确版本。

### R11. 实施 Agent

- 实施阶段由当前 Pi 会话通过原生 `trellis_subagent` 调用 Trellis `trellis-implement` Agent。
- Agent 模型固定为 Pi 内 `opencode-go` Provider 的 `deepseek-v4-flash`，完整标识为 `opencode-go/deepseek-v4-flash`。
- `trellis_subagent` 的思考等级固定为 `max`。
- 规划阶段已通过 Pi 最小只读调用确认模型可用并支持该思考参数。
- 实施派发无法使用指定模型时停止并报告，不自动替换其他 Provider 或模型。

## Out of Scope

- 独立 Tool contract package 或产品 Tool package。
- 远程 Tool endpoint、签名、网络重试、幂等、服务发现和版本协商。
- Admin 上传 TypeScript、脚本 Tool、浏览器注册 Tool或数据库动态 handler。
- Tool 配置实例、运行时启停开关和按租户覆盖 Tool 元数据。
- SemVer range、`latest`、自动升级或自动回退版本。
- Product App 的角色和权限模型；第一版只保证不会误用 Starter User 权限。
- 从持久化 snapshot 恢复正在执行的 Tool handler。

## Acceptance Criteria

- [ ] AC1：所有生产和测试 Tool 由 API 内一个显式 Catalog 入口组装，代码中不存在目录扫描或请求驱动的动态注册。
- [ ] AC2：Registry 接受同名不同版本，拒绝重复 `name@version`，执行查找必须提供精确版本。
- [ ] AC3：Agent Definition 和新 Run snapshot 保存结构化 `toolRefs`，Admin 能显示并提交 `name@version`。
- [ ] AC4：单个 Agent 同时选择同名不同版本时返回稳定的配置错误，不能把重名 Tool 交给 Pi。
- [ ] AC5：Run Service 把 Agent Service 已解析的 `RegisteredAiTool[]` 直接交给 Executor，Executor 不重新按名称查 Registry。
- [ ] AC6：Run 启动后修改 Agent Tool 配置，不改变该 Run 内存中持有的 Tool 定义；后续新 Run 使用修改后的精确版本。
- [ ] AC7：已注册 Tool 的 audit 记录名称和精确版本，未注册 Tool 与历史记录的版本为 null；成功、失败、参数无效、无权限、超时、取消和中断路径都不会留下超时后的 `running` 记录。
- [ ] AC8：`product_app` 调用需要 Starter 权限的 Tool 时被拒绝，伪造与 Starter 用户相同的 external user ID 也不能通过。
- [ ] AC9：Tool handler 类型只能访问不超过 16000 字符且已解析的参数和受限执行上下文，拿不到 Hono Context、Better Auth session、完整 runtime 或数据库 client。
- [ ] AC10：Admin/API/SSE/日志/主数据库不出现 arguments、原始 result、原始异常和 secret。
- [ ] AC11：contracts 只接受 `schemaVersion: 2 + toolRefs`；v1、`toolNames`、缺失版本和版本范围均校验失败，代码中不存在兼容读取或默认版本推断。
- [ ] AC12：相关 API、Admin、contracts 测试通过；`pnpm check-types`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`、`pnpm --filter @starter/api db:check` 和 `git diff --check` 全部通过。
- [ ] AC13：实施由 Pi 原生 `trellis_subagent` 派发 `trellis-implement`，显式使用 `opencode-go/deepseek-v4-flash` 和 `max` 思考，不使用其他 Provider 或模型替代。
