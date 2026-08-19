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
  query: AgentTranscriptQuery = { lane: 'main', limit: 50 },
): Promise<AgentTranscript> {
  const params = new URLSearchParams()
  if (query.lane) params.set('lane', query.lane)
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
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

export async function startAgentRun(
  sessionId: string,
  input: StartAgentRunInput,
  signal: AbortSignal,
  onEvent: (event: HarnessEvent) => void,
): Promise<void> {
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
  const parser = createParser({
    maxBufferSize: 2 * 1024 * 1024,
    onEvent(message) {
      if (terminalEventReceived) return
      try {
        const result = harnessEventSchema.safeParse(JSON.parse(message.data) as unknown)
        if (result.success) {
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
      const { done, value } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
    }
    parser.feed(decoder.decode())
    parser.reset({ consume: true })
    if (!terminalEventReceived && !signal.aborted) {
      throw new ApiRequestError(response.status, 'Agent Run 流意外中断，可以重试。')
    }
  } finally {
    reader.releaseLock()
  }
}
