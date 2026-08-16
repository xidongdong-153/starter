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

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

export function getSystemPrompts(): Promise<SystemPrompt[]> {
  return unwrapApiData(apiRpc.api.ai['system-prompts'].$get())
}

export function createSystemPrompt(input: CreateSystemPromptInput): Promise<SystemPrompt> {
  return unwrapApiData(apiRpc.api.ai['system-prompts'].$post({ json: input }))
}

export function updateSystemPrompt(id: string, input: UpdateSystemPromptInput): Promise<SystemPrompt> {
  return unwrapApiData(apiRpc.api.ai['system-prompts'][':id'].$put({ param: { id }, json: input }))
}

export function deleteSystemPrompt(id: string): Promise<{ deleted: boolean }> {
  return unwrapApiData(apiRpc.api.ai['system-prompts'][':id'].$delete({ param: { id } }))
}

export function getGlobalSystemPrompt(): Promise<{ systemPromptId: string | null }> {
  return unwrapApiData(apiRpc.api.ai.settings['system-prompt'].$get())
}

export function setGlobalSystemPrompt(systemPromptId: string | null): Promise<{ systemPromptId: string | null }> {
  return unwrapApiData(apiRpc.api.ai.settings['system-prompt'].$put({ json: { systemPromptId } }))
}

export function getPromptTemplates(): Promise<PromptTemplate[]> {
  return unwrapApiData(apiRpc.api.ai['prompt-templates'].$get())
}

export function createPromptTemplate(input: CreatePromptTemplateInput): Promise<PromptTemplate> {
  return unwrapApiData(apiRpc.api.ai['prompt-templates'].$post({ json: input }))
}

export function updatePromptTemplate(id: string, input: UpdatePromptTemplateInput): Promise<PromptTemplate> {
  return unwrapApiData(apiRpc.api.ai['prompt-templates'][':id'].$put({ param: { id }, json: input }))
}

export function deletePromptTemplate(id: string): Promise<{ deleted: boolean }> {
  return unwrapApiData(apiRpc.api.ai['prompt-templates'][':id'].$delete({ param: { id } }))
}

export function getSkills(): Promise<AiSkillSummary[]> {
  return unwrapApiData(apiRpc.api.ai.skills.$get())
}

export function getAiSkill(id: string): Promise<AiSkill> {
  return unwrapApiData(apiRpc.api.ai.skills[':id'].$get({ param: { id } }))
}

export function createAiSkill(input: CreateAiSkillInput): Promise<AiSkill> {
  return unwrapApiData(apiRpc.api.ai.skills.$post({ json: input }))
}

export function updateAiSkill(id: string, input: UpdateAiSkillInput): Promise<AiSkill> {
  return unwrapApiData(apiRpc.api.ai.skills[':id'].$put({ param: { id }, json: input }))
}

export function deleteAiSkill(id: string): Promise<{ deleted: boolean }> {
  return unwrapApiData(apiRpc.api.ai.skills[':id'].$delete({ param: { id } }))
}
