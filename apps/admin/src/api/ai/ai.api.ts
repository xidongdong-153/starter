import type {
  AdminAiModelsResponse,
  AdminAiProvider,
  AiConversationDetail,
  AiConversationGeneration,
  AiConversationList,
  AiConversationSummary,
  AiConversationStreamEvent,
  AiModelCallAuditDetail,
  AiModelCallAuditList,
  AiModelCallAuditQuery,
  AiModelRef,
  AiTestInput,
  AiTestStreamEvent,
  AiUserModel,
  AiUserPreference,
  CreateAiConversationInput,
  ReplaceAiEnabledModelsInput,
  RetryAiConversationGenerationInput,
  SendAiConversationMessageInput,
  UpdateAiProviderConfigInput,
} from '@starter/contracts'
import { aiConversationStreamEventSchema, aiTestStreamEventSchema } from '@starter/contracts'
import { createParser } from 'eventsource-parser'

import { ApiRequestError, apiRequest, fetchApi, resolveApiError } from '@admin/api/http'
import { apiRpc, unwrapApiData } from '@admin/api/rpc'

export function getAiProviders(): Promise<AdminAiProvider[]> {
  return unwrapApiData(apiRpc.api.ai.admin.providers.$get())
}

export function updateAiProviderConfig(input: {
  providerId: string
  values: UpdateAiProviderConfigInput
}): Promise<AdminAiProvider> {
  return unwrapApiData(
    apiRpc.api.ai.admin.providers[':providerId'].config.$put({
      param: { providerId: input.providerId },
      json: input.values,
    }),
  )
}

export function clearAiProviderCredential(providerId: string): Promise<AdminAiProvider> {
  return unwrapApiData(apiRpc.api.ai.admin.providers[':providerId'].credential.$delete({ param: { providerId } }))
}

export function checkAiProvider(providerId: string): Promise<AdminAiProvider> {
  return unwrapApiData(apiRpc.api.ai.admin.providers[':providerId'].check.$post({ param: { providerId } }))
}

export function setAiProviderState(input: { providerId: string; enabled: boolean }): Promise<AdminAiProvider> {
  return unwrapApiData(
    apiRpc.api.ai.admin.providers[':providerId'].state.$put({
      param: { providerId: input.providerId },
      json: { enabled: input.enabled },
    }),
  )
}

export function refreshAiProviderModels(providerId: string): Promise<AdminAiModelsResponse> {
  return unwrapApiData(apiRpc.api.ai.admin.providers[':providerId'].refresh.$post({ param: { providerId } }))
}

export function getAdminAiModels(): Promise<AdminAiModelsResponse> {
  return unwrapApiData(apiRpc.api.ai.admin.models.$get())
}

export function replaceAdminAiModels(input: ReplaceAiEnabledModelsInput): Promise<AdminAiModelsResponse> {
  return unwrapApiData(apiRpc.api.ai.admin.models.$put({ json: input }))
}

export function setAdminAiDefault(model: AiModelRef | null): Promise<AdminAiModelsResponse> {
  return unwrapApiData(apiRpc.api.ai.admin['default-model'].$put({ json: { model } }))
}

export function getAiModels(): Promise<AiUserModel[]> {
  return unwrapApiData(apiRpc.api.ai.models.$get())
}

export function getAiPreference(): Promise<AiUserPreference> {
  return unwrapApiData(apiRpc.api.ai.preferences.$get())
}

export function updateAiPreference(model: AiModelRef | null): Promise<AiUserPreference> {
  return unwrapApiData(apiRpc.api.ai.preferences.$put({ json: { model } }))
}

export function getAiUsageCalls(query: AiModelCallAuditQuery): Promise<AiModelCallAuditList> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  return apiRequest(`/api/ai/usage/calls?${params.toString()}`)
}

export function getAiUsageCall(callId: string): Promise<AiModelCallAuditDetail> {
  return apiRequest(`/api/ai/usage/calls/${callId}`)
}

export function createAiConversation(input: CreateAiConversationInput): Promise<AiConversationSummary> {
  return apiRequest('/api/ai/conversations', { method: 'POST', body: JSON.stringify(input) })
}

export function getAiConversations(query: { page?: number; pageSize?: number } = {}): Promise<AiConversationList> {
  const params = new URLSearchParams({ page: String(query.page ?? 1), pageSize: String(query.pageSize ?? 20) })
  return apiRequest(`/api/ai/conversations?${params.toString()}`)
}

export function getAiConversation(conversationId: string): Promise<AiConversationDetail> {
  return apiRequest(`/api/ai/conversations/${conversationId}`)
}

export function deleteAiConversation(conversationId: string): Promise<{ deleted: true }> {
  return apiRequest(`/api/ai/conversations/${conversationId}`, { method: 'DELETE' })
}

export function stopAiConversationGeneration(input: {
  conversationId: string
  generationId: string
}): Promise<AiConversationGeneration> {
  return apiRequest(`/api/ai/conversations/${input.conversationId}/generations/${input.generationId}/stop`, {
    method: 'POST',
  })
}

export async function streamAiConversation(
  input: {
    conversationId: string
    text: string
    model?: AiModelRef
  },
  signal: AbortSignal,
  onEvent: (event: AiConversationStreamEvent) => void,
): Promise<void> {
  await streamAiConversationRequest(
    `/api/ai/conversations/${input.conversationId}/messages`,
    { text: input.text, ...(input.model ? { model: input.model } : {}) },
    signal,
    onEvent,
  )
}

export async function retryAiConversation(
  input: {
    conversationId: string
    generationId: string
    model?: AiModelRef
  },
  signal: AbortSignal,
  onEvent: (event: AiConversationStreamEvent) => void,
): Promise<void> {
  const body: RetryAiConversationGenerationInput = {
    generationId: input.generationId,
    ...(input.model ? { model: input.model } : {}),
  }
  await streamAiConversationRequest(`/api/ai/conversations/${input.conversationId}/retry`, body, signal, onEvent)
}

async function streamAiConversationRequest(
  path: string,
  body: SendAiConversationMessageInput | RetryAiConversationGenerationInput,
  signal: AbortSignal,
  onEvent: (event: AiConversationStreamEvent) => void,
): Promise<void> {
  const response = await fetchApi(path, { method: 'POST', body: JSON.stringify(body), signal })
  if (!response.ok) {
    const error = await resolveApiError(response)
    throw new ApiRequestError(response.status, error.message, error.code)
  }
  if (!response.body) throw new ApiRequestError(response.status, 'API 没有返回会话响应流。')

  const decoder = new TextDecoder()
  let terminalEventReceived = false
  const parser = createParser({
    maxBufferSize: 2 * 1024 * 1024,
    onEvent(message) {
      if (terminalEventReceived) return
      try {
        const result = aiConversationStreamEventSchema.safeParse(JSON.parse(message.data) as unknown)
        if (result.success) {
          if (result.data.type === 'completed' || result.data.type === 'error') terminalEventReceived = true
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
      throw new ApiRequestError(response.status, '会话响应流意外中断，可以重试。')
    }
  } finally {
    reader.releaseLock()
  }
}

export async function streamAiTest(
  input: AiTestInput,
  signal: AbortSignal,
  onEvent: (event: AiTestStreamEvent) => void,
): Promise<void> {
  const response = await fetchApi('/api/ai/test', {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) {
    const error = await resolveApiError(response)
    throw new ApiRequestError(response.status, error.message, error.code)
  }
  if (!response.body) throw new ApiRequestError(response.status, 'API 没有返回模型响应流。')

  const decoder = new TextDecoder()
  let terminalEventReceived = false
  const parser = createParser({
    maxBufferSize: 2 * 1024 * 1024,
    onEvent(message) {
      if (terminalEventReceived) return
      try {
        const result = aiTestStreamEventSchema.safeParse(JSON.parse(message.data) as unknown)
        if (result.success) {
          if (result.data.type === 'done' || result.data.type === 'error') terminalEventReceived = true
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
      throw new ApiRequestError(response.status, '模型响应流意外中断，可以重试。')
    }
  } finally {
    reader.releaseLock()
  }
}
