import type {
  AgentDefinitionSummaryList,
  AgentRun,
  AgentSession,
  AgentTranscript,
  CreateAgentSessionInput,
  StructuredOutputList,
} from '@starter/contracts'
import {
  agentDefinitionSummaryListSchema,
  agentRunSchema,
  agentSessionSchema,
  agentTranscriptSchema,
  structuredOutputListSchema,
} from '@starter/contracts'
import { flowRpc, unwrapApiData } from '@web/lib/rpc'

/**
 * Flow 页面用到的产品面 JSON 接口，路径挂在 `/api/flow/*` 下。
 * 服务端是 AI service 的薄代理，data 由同一 service 产出，与 AI Runtime 对应端点同构；响应校验与 `chat.api.ts` 同一套做法。
 */

/** 服务端已经过滤掉未启用的 Agent，这里不再过滤。 */
export async function getRuntimeAgents(): Promise<AgentDefinitionSummaryList> {
  const data = await unwrapApiData<unknown>(
    flowRpc.api.flow.agents.$get({ query: { page: '1', pageSize: '100' } }, { init: { cache: 'no-store' } }),
  )
  return parseApiData(agentDefinitionSummaryListSchema.safeParse(data), 'Agent 列表')
}

/** Flow 每次运行新建一个 Session，不读列表、不改名、不归档。 */
export async function createAgentSession(input: CreateAgentSessionInput): Promise<AgentSession> {
  const data = await unwrapApiData<unknown>(flowRpc.api.flow.sessions.$post({ json: input }))
  return parseApiData(agentSessionSchema.safeParse(data), 'Session')
}

/**
 * 读指定 lane 最新一页 transcript；Flow 用它取 `flow-<序号>` lane 的节点产出。
 * 服务端默认 `direction=backward`、`limit=50`，`items` 是时间正序。
 */
export async function getAgentLaneTranscript(sessionId: string, lane: string): Promise<AgentTranscript> {
  const data = await unwrapApiData<unknown>(
    flowRpc.api.flow.sessions[':sessionId'].transcript.$get(
      { param: { sessionId }, query: { lane } },
      { init: { cache: 'no-store' } },
    ),
  )
  return parseApiData(agentTranscriptSchema.safeParse(data), 'Session 历史')
}

/**
 * 读 Run 的结构化输出列表；Flow 产出提取优先用它。
 * `value` 按 contract 可见性可能为 null（admin 可见性对运行面主体无值）。
 */
export async function listRunStructuredOutputs(sessionId: string, runId: string): Promise<StructuredOutputList> {
  const data = await unwrapApiData<unknown>(
    flowRpc.api.flow.sessions[':sessionId'].runs[':runId']['structured-outputs'].$get(
      { param: { runId, sessionId } },
      { init: { cache: 'no-store' } },
    ),
  )
  return parseApiData(structuredOutputListSchema.safeParse(data), 'Run 结构化输出')
}

/** 断流后用它轮询 Run 状态；Run 仍在进行时 `live` 是 API 折叠好的快照。 */
export async function getAgentRun(sessionId: string, runId: string): Promise<AgentRun> {
  const data = await unwrapApiData<unknown>(
    flowRpc.api.flow.sessions[':sessionId'].runs[':runId'].$get(
      { param: { runId, sessionId } },
      { init: { cache: 'no-store' } },
    ),
  )
  return parseApiData(agentRunSchema.safeParse(data), 'Agent Run')
}

/** 取消仍在运行的 Run。已经进终态的 Run 返回 409 `AI.RUN_NOT_ACTIVE`。 */
export async function abortAgentRun(sessionId: string, runId: string): Promise<AgentRun> {
  const data = await unwrapApiData<unknown>(
    flowRpc.api.flow.sessions[':sessionId'].runs[':runId'].abort.$post({ param: { runId, sessionId } }),
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
