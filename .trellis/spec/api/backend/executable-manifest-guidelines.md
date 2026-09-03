# Executable Manifest 规范

## 1. Scope / Trigger

- 修改 Agent 执行发现接口、公开 Manifest presenter、Manifest hash 或 Run 的 Agent revision 前置校验时使用本规范。
- 涉及文件：`packages/contracts/src/ai.ts`、`apps/api/src/modules/ai/agent/`、`apps/api/src/modules/ai/run/run.service.ts`。
- 本规范不定义远程 Tool transport、应用能力策略、webhook 或新的 Runtime port。

## 2. Signatures

运行面接口：

```text
GET /api/ai/executables
GET /api/ai/executables/{executableId}
POST /api/ai/sessions/{sessionId}/runs
```

Service 与 presenter：

```ts
interface AiAgentDefinitionService {
  listExecutableManifests(
    query: ExecutableManifestListQuery,
    access: RuntimeAccessContext,
  ): Promise<ExecutableManifestList>
  getExecutableManifest(id: string, access: RuntimeAccessContext): Promise<ExecutableManifestV1>
}

function toExecutableManifestV1(
  definition: Pick<AgentDefinitionSummary, 'id' | 'name' | 'description'>,
  resolved: ResolvedAgentDefinition,
): ExecutableManifestV1
```

Run 启动的可选版本条件：

```ts
interface StartAgentRunInput {
  agentId?: string
  expectedAgentRevision?: number
}
```

## 3. Contracts

- 两个发现接口都挂 `requireRuntimePrincipal`，支持 cookie 用户和 Bearer `product_app`。不允许匿名访问。
- 列表和详情只返回 `status=enabled` 的预设 Agent。draft、disabled 和不存在的详情统一 404，不暴露状态差异。
- Manifest V1 是 strict DTO，只包含 `manifestSchemaVersion`、`kind`、`id`、`version`、`name`、`description`、`inputSchema`、`output`、`eventProtocolVersion`、`controls`、`sideEffect`、`manifestHash`。
- `inputSchema` 由 `executableAgentInputSchema` 转为 draft-7 JSON Schema，只描述 `input`、`lane`、`idempotencyKey`、`attachmentIds`。它不包含已经由 URL 或 Manifest 固定的 `agentId`、`config`、`expectedAgentRevision`。
- `output` 为 null 或 `{ contract, schema }`。只公开 Output Contract 引用与完整 JSON Schema；`visibility=admin` 也公开 schema，因为这里没有输出值。
- `sideEffect` 取全部 resolved Tools 的最强等级：`read_only < idempotent_write < non_idempotent_write`；无 Tool 时为 `read_only`。
- `manifestHash` 用 canonical JSON 后的 SHA-256 生成。hash 输入包含 Agent id/revision、输入/输出 schema、事件协议、controls、side effect、model/execution 参数、Prompt/Skill revision 与 content hash、Tool manifest hash。`name`、`description` 不进入 hash。
- 公开 DTO 不包含 Prompt/Skill 正文及 content hash、provider/model id、Tool 名称与 input schema、scope、权限、timeout、handler 或内部 resolved manifest。
- `expectedAgentRevision` 只能是正整数，并且必须与显式 `agentId` 同时提供，不能与内联 `config` 同时使用。不传该字段的旧客户端继续执行当前 revision。
- Run Service 必须在 preset Agent resolve 后立即比较当前 revision。冲突检查位于附件解析、幂等预检查、进程内 reserve、持久 lease 和 Run/Attempt 创建之前。

## 4. Validation & Error Matrix

| 条件 | HTTP | Error code |
| --- | --- | --- |
| 发现接口无 cookie/Bearer 主体 | 401 | `AUTH.UNAUTHENTICATED` |
| Manifest id 非 UUID、分页非法 | 400 | `COMMON.INVALID_REQUEST` |
| Manifest 对应 Agent 不存在、draft 或 disabled | 404 | `COMMON.NOT_FOUND` |
| enabled Agent 的执行配置无法 resolve | 400/404/409 | 保留 `resolve()` 的既有错误 code |
| `expectedAgentRevision < 1` | 400 | `COMMON.INVALID_REQUEST` |
| 有 `expectedAgentRevision` 但没有显式 `agentId` | 400 | `COMMON.INVALID_REQUEST` |
| `expectedAgentRevision` 与 `config` 同时出现 | 400 | `COMMON.INVALID_REQUEST` |
| resolved Agent revision 与期望值不同 | 409 | `AI.AGENT_REVISION_CONFLICT` |

## 5. Good / Base / Bad Cases

- Good：客户端先读 Manifest V1，提交同一 `agentId` 和 `expectedAgentRevision=manifest.version`，服务端只在 revision 仍匹配时启动。
- Good：Agent config、Prompt、Skill 或 Tool manifest 变化后，Manifest 的 `version` 或 `manifestHash` 变化；只改 Agent name/description 时 hash 不变。
- Base：旧客户端不发送 `expectedAgentRevision`，服务端按当前 Agent revision 启动。
- Bad：客户端把 Manifest 当成内部 resolved config，依赖 model id、Prompt 正文或 Tool handler 等未公开字段。
- Bad：revision 冲突先命中历史幂等 Run，或先解析附件、占 lane、创建 Run 后才返回 409。

## 6. Tests Required

`apps/api/src/test/ai-executable-manifest.test.ts` 至少断言：

- cookie 与 Bearer 都能读取列表/详情，匿名 401，列表只含 enabled，draft/disabled 详情 404。
- 响应通过 `executableManifestV1Schema`，公开字段精确且无敏感执行事实；Output Contract 的完整 schema 可读取。
- 同一执行事实重复读取 hash 稳定；展示字段不影响 hash；Agent config、Prompt、Skill 与同名同版本 Tool 定义变化能传播到 version/hash。
- OpenAPI 同时声明 cookie/Bearer security，并包含两个发现路径。
- matching revision 成功；stale revision 返回 409；非法值和非法组合返回 400；不传版本仍成功。
- revision 冲突不创建 Run/Attempt、不占进程内或持久 lane lease、不消费 idempotency key，并且不会先返回附件错误。

同时回归：

```bash
pnpm --filter @starter/api test
pnpm check
pnpm test
```

## 7. Wrong vs Correct

错误写法在幂等或资源操作之后比较 revision：

```ts
const existing = findIdempotentRun(input.idempotencyKey)
const attachments = resolveAttachments(input.attachmentIds)
const lease = reserve(input.sessionId, input.lane)
if (resolved.revision !== input.expectedAgentRevision) throw revisionConflict()
```

正确写法复用 `resolve()` 的当前事实，并在任何有副作用的步骤前返回冲突：

```ts
const resolved = await resolvePresetAgent(input, session, access)
if (input.expectedAgentRevision !== undefined && resolved.revision !== input.expectedAgentRevision) {
  throw new AppError(ApiErrorCodes.AI_AGENT_REVISION_CONFLICT, 'Agent revision 与请求期望不一致', 409)
}

const attachments = resolveAttachments(input.attachmentIds)
const existing = findIdempotentRun(input.idempotencyKey)
const lease = reserve(input.sessionId, input.lane)
```
