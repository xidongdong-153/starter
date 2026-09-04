import type { AiApplication, CreateAiApplicationInput, UpdateAiApplicationPolicyInput } from '@starter/contracts'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createAiApplication,
  getAiApplications,
  revokeAiApplication,
  rotateAiApplicationSecret,
  updateAiApplicationPolicy,
} from './application.api'
import { aiQueryKeys } from './ai.query'

export function useAiApplicationsQuery(enabled = true) {
  return useQuery<AiApplication[]>({
    queryKey: aiQueryKeys.applications(),
    queryFn: getAiApplications,
    enabled,
  })
}

/** 返回值带一次性 secret，只交给调用方展示，不写入 query cache。 */
export function useCreateAiApplicationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAiApplicationInput) => createAiApplication(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.applications() })
    },
  })
}

/** 返回值带一次性 secret，只交给调用方展示，不写入 query cache。 */
export function useRotateAiApplicationSecretMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rotateAiApplicationSecret,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.applications() })
    },
  })
}

export function useUpdateAiApplicationPolicyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { appId: string; values: UpdateAiApplicationPolicyInput }) =>
      updateAiApplicationPolicy(input.appId, input.values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.applications() })
    },
  })
}

export function useRevokeAiApplicationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revokeAiApplication,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.applications() })
    },
  })
}
