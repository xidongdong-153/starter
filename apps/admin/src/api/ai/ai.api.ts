import type {
  AdminAiModelsResponse,
  AdminAiProvider,
  AiModelCallAuditDetail,
  AiModelCallAuditList,
  AiModelCallAuditQuery,
  AiModelRef,
  AiTestInput,
  AiTestStreamEvent,
  AiUserModel,
  AiUserPreference,
  CheckCustomAiProviderInput,
  CreateCustomAiProviderInput,
  CustomAiProvider,
  DeleteCustomAiProviderInput,
  ReplaceAiEnabledModelsInput,
  ReplaceCustomAiProviderModelsInput,
  UpdateCustomAiProviderCredentialInput,
  UpdateCustomAiProviderInput,
  UpdateAiProviderConfigInput,
} from '@starter/contracts'
import { aiTestStreamEventSchema } from '@starter/contracts'
import { createParser } from 'eventsource-parser'

import { ApiRequestError, apiRequest, fetchApi, resolveApiError } from '@admin/api/http'
import { apiRpc, unwrapApiData, unwrapApiVoid } from '@admin/api/rpc'

const customProvidersRpc = apiRpc.api.ai.admin['custom-providers']

export function getAiProviders(): Promise<AdminAiProvider[]> {
  return unwrapApiData(apiRpc.api.ai.admin.providers.$get())
}

export function getCustomAiProviders(): Promise<CustomAiProvider[]> {
  return unwrapApiData(customProvidersRpc.$get())
}

export function getCustomAiProvider(providerId: string): Promise<CustomAiProvider> {
  return unwrapApiData(customProvidersRpc[':providerId'].$get({ param: { providerId } }))
}

export function createCustomAiProvider(input: CreateCustomAiProviderInput): Promise<CustomAiProvider> {
  return unwrapApiData(customProvidersRpc.$post({ json: input }))
}

export function updateCustomAiProvider(input: {
  providerId: string
  values: UpdateCustomAiProviderInput
}): Promise<CustomAiProvider> {
  return unwrapApiData(
    customProvidersRpc[':providerId'].$put({
      param: { providerId: input.providerId },
      json: input.values,
    }),
  )
}

export function replaceCustomAiProviderModels(input: {
  providerId: string
  values: ReplaceCustomAiProviderModelsInput
}): Promise<CustomAiProvider> {
  return unwrapApiData(
    customProvidersRpc[':providerId'].models.$put({
      param: { providerId: input.providerId },
      json: input.values,
    }),
  )
}

export function updateCustomAiProviderCredential(input: {
  providerId: string
  values: UpdateCustomAiProviderCredentialInput
}): Promise<CustomAiProvider> {
  return unwrapApiData(
    customProvidersRpc[':providerId'].credential.$put({
      param: { providerId: input.providerId },
      json: input.values,
    }),
  )
}

export function clearCustomAiProviderCredential(providerId: string): Promise<CustomAiProvider> {
  return unwrapApiData(customProvidersRpc[':providerId'].credential.$delete({ param: { providerId } }))
}

export function checkCustomAiProvider(input: {
  providerId: string
  values: CheckCustomAiProviderInput
}): Promise<CustomAiProvider> {
  return unwrapApiData(
    customProvidersRpc[':providerId'].check.$post({
      param: { providerId: input.providerId },
      json: input.values,
    }),
  )
}

export function setCustomAiProviderState(input: { providerId: string; enabled: boolean }): Promise<CustomAiProvider> {
  return unwrapApiData(
    customProvidersRpc[':providerId'].state.$put({
      param: { providerId: input.providerId },
      json: { enabled: input.enabled },
    }),
  )
}

export function deleteCustomAiProvider(input: {
  providerId: string
  values: DeleteCustomAiProviderInput
}): Promise<void> {
  return unwrapApiVoid(
    customProvidersRpc[':providerId'].$delete({
      param: { providerId: input.providerId },
      json: input.values,
    }),
  )
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
