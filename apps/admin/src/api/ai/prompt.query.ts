import type {
  AiSkill,
  AiSkillSummary,
  CreateAiSkillInput,
  CreatePromptTemplateInput,
  CreateSystemPromptInput,
  PromptTemplate,
  SystemPrompt,
  UpdateAiSkillInput,
  UpdatePromptTemplateInput,
  UpdateSystemPromptInput,
} from '@starter/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createAiSkill,
  createPromptTemplate,
  createSystemPrompt,
  deleteAiSkill,
  deletePromptTemplate,
  deleteSystemPrompt,
  getAiSkill,
  getGlobalSystemPrompt,
  getPromptTemplates,
  getSkills,
  getSystemPrompts,
  setGlobalSystemPrompt,
  updateAiSkill,
  updatePromptTemplate,
  updateSystemPrompt,
} from './prompt.api'
import { aiQueryKeys } from './ai.query'

export function useSystemPromptsQuery(enabled = true) {
  return useQuery<SystemPrompt[]>({
    queryKey: aiQueryKeys.systemPrompts(),
    queryFn: getSystemPrompts,
    enabled,
  })
}

export function useGlobalSystemPromptQuery(enabled = true) {
  return useQuery<{ systemPromptId: string | null }>({
    queryKey: aiQueryKeys.globalSystemPrompt(),
    queryFn: getGlobalSystemPrompt,
    enabled,
  })
}

export function useCreateSystemPromptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSystemPromptInput) => createSystemPrompt(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.systemPrompts() })
    },
  })
}

export function useUpdateSystemPromptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; values: UpdateSystemPromptInput }) => updateSystemPrompt(input.id, input.values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.systemPrompts() })
    },
  })
}

export function useDeleteSystemPromptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteSystemPrompt,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.systemPrompts() })
    },
  })
}

export function useSetGlobalSystemPromptMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setGlobalSystemPrompt,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.systemPrompts() }),
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.globalSystemPrompt() }),
      ])
    },
  })
}

export function usePromptTemplatesQuery(enabled = true) {
  return useQuery<PromptTemplate[]>({
    queryKey: aiQueryKeys.promptTemplates(),
    queryFn: getPromptTemplates,
    enabled,
  })
}

export function useCreatePromptTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePromptTemplateInput) => createPromptTemplate(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.promptTemplates() }),
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.promptTemplatesPublic() }),
      ])
    },
  })
}

export function useUpdatePromptTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; values: UpdatePromptTemplateInput }) =>
      updatePromptTemplate(input.id, input.values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.promptTemplates() }),
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.promptTemplatesPublic() }),
      ])
    },
  })
}

export function useDeletePromptTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deletePromptTemplate,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.promptTemplates() }),
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.promptTemplatesPublic() }),
      ])
    },
  })
}

export function useSkillsQuery(enabled = true) {
  return useQuery<AiSkillSummary[]>({
    queryKey: aiQueryKeys.skills(),
    queryFn: getSkills,
    enabled,
  })
}

export function useAiSkillDetailQuery(skillId: string | null) {
  return useQuery<AiSkill>({
    queryKey: aiQueryKeys.skillDetail(skillId ?? ''),
    queryFn: () => getAiSkill(skillId ?? ''),
    enabled: skillId !== null,
  })
}

export function useCreateAiSkillMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAiSkillInput) => createAiSkill(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiQueryKeys.skills() })
    },
  })
}

export function useUpdateAiSkillMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; values: UpdateAiSkillInput }) => updateAiSkill(input.id, input.values),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.skills() }),
        queryClient.removeQueries({ queryKey: aiQueryKeys.skillDetail(input.id) }),
      ])
    },
  })
}

export function useDeleteAiSkillMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteAiSkill,
    onSuccess: async (_data, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: aiQueryKeys.skills() }),
        queryClient.removeQueries({ queryKey: aiQueryKeys.skillDetail(id) }),
      ])
    },
  })
}
