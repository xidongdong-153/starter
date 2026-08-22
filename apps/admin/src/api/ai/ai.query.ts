import type {
  AiModelCallAuditDetail,
  AiModelCallAuditList,
  AiModelCallAuditQuery,
  AiModelRef,
  ReplaceAiEnabledModelsInput,
  UpdateAiProviderConfigInput,
} from '@starter/contracts'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  checkAiProvider,
  clearAiProviderCredential,
  getAdminAiModels,
  getAiModels,
  getAiPreference,
  getAiProviders,
  getAiUsageCall,
  getAiUsageCalls,
  refreshAiProviderModels,
  replaceAdminAiModels,
  setAdminAiDefault,
  setAiProviderState,
  updateAiPreference,
  updateAiProviderConfig,
} from './ai.api'

export const aiQueryKeys = {
  all: ['ai'] as const,
  admin: ['ai', 'admin'] as const,
  adminModels: () => [...aiQueryKeys.admin, 'models'] as const,
  adminProviders: () => [...aiQueryKeys.admin, 'providers'] as const,
  applications: () => [...aiQueryKeys.admin, 'applications'] as const,
  usageCalls: () => [...aiQueryKeys.admin, 'usage', 'calls'] as const,
  usageCallList: (query: AiModelCallAuditQuery) => [...aiQueryKeys.usageCalls(), query] as const,
  usageCallDetail: (callId: string) => [...aiQueryKeys.admin, 'usage', 'call', callId] as const,
  models: () => [...aiQueryKeys.all, 'models'] as const,
  preference: () => [...aiQueryKeys.all, 'preference'] as const,
  systemPrompts: () => [...aiQueryKeys.admin, 'system-prompts'] as const,
  globalSystemPrompt: () => [...aiQueryKeys.admin, 'settings', 'system-prompt'] as const,
  promptTemplates: () => [...aiQueryKeys.admin, 'prompt-templates'] as const,
  promptTemplatesPublic: () => [...aiQueryKeys.all, 'prompt-templates'] as const,
  skills: () => [...aiQueryKeys.all, 'skills'] as const,
  skillDetails: () => [...aiQueryKeys.skills(), 'detail'] as const,
  skillDetail: (skillId: string) => [...aiQueryKeys.skillDetails(), skillId] as const,
}

export const aiProvidersQueryOptions = queryOptions({
  queryKey: aiQueryKeys.adminProviders(),
  queryFn: getAiProviders,
})

export function useAiUsageCallsQuery(query: AiModelCallAuditQuery) {
  return useQuery<AiModelCallAuditList>({
    queryKey: aiQueryKeys.usageCallList(query),
    queryFn: () => getAiUsageCalls(query),
  })
}

export function useAiUsageCallQuery(callId: string | null) {
  return useQuery<AiModelCallAuditDetail>({
    queryKey: aiQueryKeys.usageCallDetail(callId ?? ''),
    queryFn: () => getAiUsageCall(callId ?? ''),
    enabled: callId !== null,
  })
}

export function useAiProvidersQuery(enabled = true) {
  return useQuery({ ...aiProvidersQueryOptions, enabled })
}

export function useAdminAiModelsQuery(enabled = true) {
  return useQuery({ queryKey: aiQueryKeys.adminModels(), queryFn: getAdminAiModels, enabled })
}

export function useAiModelsQuery() {
  return useQuery({ queryKey: aiQueryKeys.models(), queryFn: getAiModels })
}

export function useAiPreferenceQuery() {
  return useQuery({ queryKey: aiQueryKeys.preference(), queryFn: getAiPreference })
}

async function invalidateAdminAi(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: aiQueryKeys.adminProviders() }),
    queryClient.invalidateQueries({ queryKey: aiQueryKeys.adminModels() }),
    queryClient.invalidateQueries({ queryKey: aiQueryKeys.models() }),
    queryClient.invalidateQueries({ queryKey: aiQueryKeys.preference() }),
  ])
}

export function useUpdateAiProviderConfigMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { providerId: string; values: UpdateAiProviderConfigInput }) => updateAiProviderConfig(input),
    onSuccess: () => invalidateAdminAi(queryClient),
  })
}

export function useClearAiProviderCredentialMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: clearAiProviderCredential,
    onSuccess: () => invalidateAdminAi(queryClient),
  })
}

export function useCheckAiProviderMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: checkAiProvider,
    // 检查失败也会把规范化的 error 状态写入数据库。
    onSettled: () => invalidateAdminAi(queryClient),
  })
}

export function useSetAiProviderStateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { providerId: string; enabled: boolean }) => setAiProviderState(input),
    onSuccess: () => invalidateAdminAi(queryClient),
  })
}

export function useRefreshAiProviderModelsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: refreshAiProviderModels,
    onSuccess: () => invalidateAdminAi(queryClient),
  })
}

export function useReplaceAdminAiModelsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ReplaceAiEnabledModelsInput) => replaceAdminAiModels(input),
    onSuccess: () => invalidateAdminAi(queryClient),
  })
}

export function useSetAdminAiDefaultMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (model: AiModelRef | null) => setAdminAiDefault(model),
    onSuccess: () => invalidateAdminAi(queryClient),
  })
}

export function useUpdateAiPreferenceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (model: AiModelRef | null) => updateAiPreference(model),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.preference() }),
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.models() }),
      ])
    },
  })
}
