import type {
  AgentDefinitionSummaryList,
  AgentRun,
  AgentSession,
  AgentSessionList,
  AgentTranscript,
  CreateAgentSessionInput,
} from '@starter/contracts'
import {
  agentDefinitionSummaryListSchema,
  agentRunSchema,
  agentSessionListSchema,
  agentSessionSchema,
  agentTranscriptSchema,
} from '@starter/contracts'
import { apiRpc, unwrapApiData } from '@web/lib/rpc'

/**
 * Chat 页面用到的 AI Runtime JSON 接口。
 *
 * 响应用 `@starter/contracts` 的 schema 校验，不在这里手写 guard：
 * transcript 和 Run live 快照是嵌套联合，手写一份等于把协议复制到 Web。
 * 启动 Run 的 SSE 不在这里，它的响应不是 `{ ok, data }` envelope，见 `lib/ai/run-event-stream.ts`。
 */

/** 服务端已经过滤掉未启用的 Agent，这里不再过滤。 */
export async function getRuntimeAgents(): Promise<AgentDefinitionSummaryList> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.ai.agents.$get({ query: { page: '1', pageSize: '100' } }, { init: { cache: 'no-store' } }),
  )
  return parseApiData(agentDefinitionSummaryListSchema.safeParse(data), 'Agent 列表')
}

/** 默认不含已归档 Session，按更新时间倒序。 */
export async function getAgentSessions(): Promise<AgentSessionList> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.ai.sessions.$get({ query: { page: '1', pageSize: '20' } }, { init: { cache: 'no-store' } }),
  )
  return parseApiData(agentSessionListSchema.safeParse(data), 'Session 列表')
}

export async function createAgentSession(input: CreateAgentSessionInput): Promise<AgentSession> {
  const data = await unwrapApiData<unknown>(apiRpc.api.ai.sessions.$post({ json: input }))
  return parseApiData(agentSessionSchema.safeParse(data), 'Session')
}

/** 改 Session 标题；只传 title，不设置会话级 defaultAgentId。 */
export async function renameAgentSession(sessionId: string, title: string): Promise<AgentSession> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.ai.sessions[':sessionId'].$patch({ param: { sessionId }, json: { title } }),
  )
  return parseApiData(agentSessionSchema.safeParse(data), 'Session')
}

/** 归档 Session。归档后从列表消失，API 没有恢复接口，返回归档后的 Session。 */
export async function archiveAgentSession(sessionId: string): Promise<AgentSession> {
  const data = await unwrapApiData<unknown>(apiRpc.api.ai.sessions[':sessionId'].$delete({ param: { sessionId } }))
  return parseApiData(agentSessionSchema.safeParse(data), 'Session')
}

/**
 * 读 main lane 最新一页 transcript。
 * 服务端默认 `direction=backward`、`limit=50`，`items` 是时间正序；本页不做翻页，忽略 `nextCursor`。
 */
export async function getAgentTranscript(sessionId: string): Promise<AgentTranscript> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.ai.sessions[':sessionId'].transcript.$get(
      { param: { sessionId }, query: {} },
      { init: { cache: 'no-store' } },
    ),
  )
  return parseApiData(agentTranscriptSchema.safeParse(data), 'Session 历史')
}

/** 断流后用它轮询 Run 状态；Run 仍在进行时 `live` 是 API 折叠好的快照。 */
export async function getAgentRun(sessionId: string, runId: string): Promise<AgentRun> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.ai.sessions[':sessionId'].runs[':runId'].$get(
      { param: { runId, sessionId } },
      { init: { cache: 'no-store' } },
    ),
  )
  return parseApiData(agentRunSchema.safeParse(data), 'Agent Run')
}

/**
 * 查当前会话 main lane 仍在跑的 Run，刷新页面后用它拿回 runId。
 * 返回 null 表示没有 Run 在跑（包括 API 进程重启后被标成 interrupted 的），页面保持静态历史。
 */
export async function getActiveAgentRun(sessionId: string): Promise<AgentRun | null> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.ai.sessions[':sessionId']['active-run'].$get(
      { param: { sessionId }, query: {} },
      { init: { cache: 'no-store' } },
    ),
  )
  return parseApiData(agentRunSchema.nullable().safeParse(data), '进行中的 Agent Run')
}

/** 取消仍在运行的 Run。已经进终态的 Run 返回 409 `AI.RUN_NOT_ACTIVE`。 */
export async function abortAgentRun(sessionId: string, runId: string): Promise<AgentRun> {
  const data = await unwrapApiData<unknown>(
    apiRpc.api.ai.sessions[':sessionId'].runs[':runId'].abort.$post({ param: { runId, sessionId } }),
  )
  return parseApiData(agentRunSchema.safeParse(data), 'Agent Run')
}

/** 校验失败时抛出，错误里带上是哪个接口的数据对不上。 */
function parseApiData<TData>(result: { data: TData; success: true } | { success: false }, source: string): TData {
  if (!result.success) {
    throw new Error(`${source}的数据格式不正确。`)
  }
  return result.data
}
