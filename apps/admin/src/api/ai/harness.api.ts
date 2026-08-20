import type {
  AgentRun,
  AgentSession,
  AgentSessionList,
  AgentSessionListQuery,
  AgentTranscript,
  AgentTranscriptQuery,
  CreateAgentSessionInput,
  HarnessEvent,
  StartAgentRunInput,
  UpdateAgentSessionInput,
} from '@starter/contracts'
import { harnessEventSchema } from '@starter/contracts'
import { createParser } from 'eventsource-parser'

import { ApiRequestError, fetchApi, resolveApiError } from '@admin/api/http'
import { apiRpc, unwrapApiData } from '@admin/api/rpc'

export function getAgentSessions(query: AgentSessionListQuery = { page: 1, pageSize: 20 }): Promise<AgentSessionList> {
  return unwrapApiData(
    apiRpc.api.ai.sessions.$get({
      query: { page: String(query.page), pageSize: String(query.pageSize) },
    }),
  )
}

export function getAgentSession(sessionId: string): Promise<AgentSession> {
  return unwrapApiData(apiRpc.api.ai.sessions[':sessionId'].$get({ param: { sessionId } }))
}

export function createAgentSession(input: CreateAgentSessionInput): Promise<AgentSession> {
  return unwrapApiData(apiRpc.api.ai.sessions.$post({ json: input }))
}

export function updateAgentSession(input: {
  sessionId: string
  values: UpdateAgentSessionInput
}): Promise<AgentSession> {
  return unwrapApiData(
    apiRpc.api.ai.sessions[':sessionId'].$patch({
      param: { sessionId: input.sessionId },
      json: input.values,
    }),
  )
}

export function archiveAgentSession(sessionId: string): Promise<AgentSession> {
  return unwrapApiData(apiRpc.api.ai.sessions[':sessionId'].$delete({ param: { sessionId } }))
}

export function getAgentTranscript(
  sessionId: string,
  query: AgentTranscriptQuery = { lane: 'main', limit: 50, direction: 'backward' },
): Promise<AgentTranscript> {
  const params = new URLSearchParams()
  if (query.lane) params.set('lane', query.lane)
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.direction) params.set('direction', query.direction)
  return unwrapApiData(
    apiRpc.api.ai.sessions[':sessionId'].transcript.$get({
      param: { sessionId },
      query: Object.fromEntries(params),
    }),
  )
}

export function getAgentRun(sessionId: string, runId: string): Promise<AgentRun> {
  return unwrapApiData(
    apiRpc.api.ai.sessions[':sessionId'].runs[':runId'].$get({
      param: { sessionId, runId },
    }),
  )
}

export function abortAgentRun(sessionId: string, runId: string): Promise<AgentRun> {
  return unwrapApiData(
    apiRpc.api.ai.sessions[':sessionId'].runs[':runId'].abort.$post({
      param: { sessionId, runId },
    }),
  )
}

/**
 * 启动一次 Agent Run 并消费 SSE。
 *
 * 返回 `terminal` 说明是否收到了终态事件。服务端事件队列有上限（超限直接关流），
 * 连接也可能中途断开，两种情况都不代表 Run 失败：Run 仍在后台跑，
 * 调用方此时转轮询 `GET /runs/{runId}`。
 * 只有启动阶段失败（HTTP 错误、没有响应体、一个事件都没收到就断流）和用户主动取消才抛出。
 */
export async function startAgentRun(
  sessionId: string,
  input: StartAgentRunInput,
  signal: AbortSignal,
  onEvent: (event: HarnessEvent) => void,
): Promise<{ terminal: boolean }> {
  const response = await fetchApi(`/api/ai/sessions/${sessionId}/runs`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) {
    const error = await resolveApiError(response)
    throw new ApiRequestError(response.status, error.message, error.code)
  }
  if (!response.body) throw new ApiRequestError(response.status, 'API 没有返回 Agent Run 流。')

  const decoder = new TextDecoder()
  let terminalEventReceived = false
  let receivedEventCount = 0
  const parser = createParser({
    maxBufferSize: 2 * 1024 * 1024,
    onEvent(message) {
      if (terminalEventReceived) return
      try {
        const result = harnessEventSchema.safeParse(JSON.parse(message.data) as unknown)
        if (result.success) {
          receivedEventCount += 1
          if (
            result.data.type === 'run.completed' ||
            result.data.type === 'run.failed' ||
            result.data.type === 'run.aborted'
          ) {
            terminalEventReceived = true
          }
          onEvent(result.data)
        }
      } catch {
        // 损坏或未知事件不能进入组件状态。
      }
    },
  })
  const reader = response.body.getReader()
  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>
      try {
        chunk = await reader.read()
      } catch (error) {
        // 用户主动取消照旧抛出，页面按取消处理，不能误判成断线。
        if (signal.aborted) throw error
        // 已经收到过事件、还没收到终态：连接中途断了，Run 还在后台跑，交给调用方轮询。
        if (receivedEventCount > 0 && !terminalEventReceived) return { terminal: false }
        throw error
      }
      if (chunk.done) break
      parser.feed(decoder.decode(chunk.value, { stream: true }))
    }
    parser.feed(decoder.decode())
    parser.reset({ consume: true })
    return { terminal: terminalEventReceived }
  } finally {
    reader.releaseLock()
  }
}
