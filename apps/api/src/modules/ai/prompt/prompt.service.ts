import { ApiErrorCodes } from '@starter/contracts'
import type {
  CreatePromptTemplateInput,
  CreateSystemPromptInput,
  SystemPrompt,
  PromptTemplate,
  UpdatePromptTemplateInput,
  UpdateSystemPromptInput,
} from '@starter/contracts'

import { AppError } from '@api/shared/app-error.js'
import { generateId } from '@api/shared/id.js'

import type { AiPromptRepository, AiSystemPromptRecord } from './prompt.repository.js'

export interface AiPromptService {
  listSystemPrompts: () => SystemPrompt[]
  createSystemPrompt: (input: CreateSystemPromptInput, actorId: string) => SystemPrompt
  updateSystemPrompt: (id: string, input: UpdateSystemPromptInput, actorId: string) => SystemPrompt
  deleteSystemPrompt: (id: string) => boolean
  setGlobalSystemPrompt: (systemPromptId: string | null, actorId: string) => { systemPromptId: string | null }
  listTemplates: () => PromptTemplate[]
  createTemplate: (input: CreatePromptTemplateInput, actorId: string) => PromptTemplate
  updateTemplate: (id: string, input: UpdatePromptTemplateInput, actorId: string) => PromptTemplate
  deleteTemplate: (id: string) => boolean
  resolveSystemPromptContent: (systemPromptId: string | null) => string | null
  getGlobalSystemPromptId: () => string | null
  assertSystemPromptAvailable: (systemPromptId: string | null) => void
  /** 当前 revision（主表 current_revision）；不存在或未启用返回 null。 */
  getSystemPromptRevision: (systemPromptId: string) => number | null
  /** 读取不可变 revision 行内容；不存在返回 null。 */
  findSystemPromptRevisionContent: (systemPromptId: string, revision: number) => string | null
  /**
   * 按 pinned revision 读取内容：revision 行存在时返回该行内容与 revision；
   * 行缺失（绕过 repository 写入的数据）回退主表当前内容与当前 revision。
   * 不存在或未启用返回 null。
   */
  resolveSystemPromptForManifest: (
    systemPromptId: string,
    pinnedRevision: number | null,
  ) => { content: string; revision: number } | null
}

export function createAiPromptService(repository: AiPromptRepository): AiPromptService {
  function requireSystemPrompt(id: string) {
    const record = repository.findSystemPromptById(id)
    if (!record) {
      throw new AppError(ApiErrorCodes.AI_PROMPT_NOT_FOUND, '系统提示词不存在', 404)
    }
    return record
  }

  function toSystemPrompt(record: AiSystemPromptRecord): SystemPrompt {
    return {
      id: record.id,
      name: record.name,
      content: record.content,
      enabled: record.enabled,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }

  return {
    listSystemPrompts() {
      return repository.listSystemPrompts().map(toSystemPrompt)
    },
    createSystemPrompt(input, actorId) {
      const now = new Date()
      const record = repository.createSystemPrompt({
        id: generateId(),
        name: input.name,
        content: input.content,
        enabled: input.enabled ?? true,
        actorId,
        now,
      })
      return toSystemPrompt(record)
    },
    updateSystemPrompt(id, input, actorId) {
      requireSystemPrompt(id)
      const record = repository.updateSystemPrompt({
        id,
        name: input.name,
        content: input.content,
        enabled: input.enabled,
        actorId,
        now: new Date(),
      })
      return toSystemPrompt(record!)
    },
    deleteSystemPrompt(id) {
      requireSystemPrompt(id)
      if (repository.isSystemPromptReferenced(id)) {
        throw new AppError(
          ApiErrorCodes.AI_PROMPT_REFERENCED,
          '系统提示词已被全局默认、会话或 Agent 引用，不能删除',
          409,
        )
      }
      return repository.deleteSystemPrompt(id)
    },
    setGlobalSystemPrompt(systemPromptId, actorId) {
      if (systemPromptId) requireSystemPrompt(systemPromptId)
      repository.setGlobalSystemPrompt(systemPromptId, actorId, new Date())
      return { systemPromptId }
    },
    listTemplates() {
      return repository.listTemplates().map(toTemplate)
    },
    createTemplate(input, actorId) {
      const now = new Date()
      const record = repository.createTemplate({
        id: generateId(),
        name: input.name,
        description: input.description ?? '',
        content: input.content,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0,
        actorId,
        now,
      })
      return toTemplate(record)
    },
    updateTemplate(id, input, actorId) {
      requireTemplate(id)
      const record = repository.updateTemplate({
        id,
        name: input.name,
        description: input.description,
        content: input.content,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
        actorId,
        now: new Date(),
      })
      return toTemplate(record!)
    },
    deleteTemplate(id) {
      requireTemplate(id)
      return repository.deleteTemplate(id)
    },
    resolveSystemPromptContent(systemPromptId) {
      if (!systemPromptId) return null
      const record = repository.findSystemPromptById(systemPromptId)
      if (!record || !record.enabled) return null
      return record.content
    },
    getGlobalSystemPromptId() {
      return repository.getGlobalSystemPromptId()
    },
    assertSystemPromptAvailable(systemPromptId) {
      if (!systemPromptId) return
      const record = repository.findSystemPromptById(systemPromptId)
      if (!record || !record.enabled) {
        throw new AppError(ApiErrorCodes.AI_PROMPT_NOT_FOUND, '系统提示词不存在或未启用', 404)
      }
    },
    getSystemPromptRevision(systemPromptId) {
      const record = repository.findSystemPromptById(systemPromptId)
      if (!record || !record.enabled) return null
      return record.currentRevision
    },
    findSystemPromptRevisionContent(systemPromptId, revision) {
      return repository.findSystemPromptRevisionContent(systemPromptId, revision) ?? null
    },
    resolveSystemPromptForManifest(systemPromptId, pinnedRevision) {
      const record = repository.findSystemPromptById(systemPromptId)
      if (!record || !record.enabled) return null
      if (pinnedRevision !== null) {
        const content = repository.findSystemPromptRevisionContent(systemPromptId, pinnedRevision)
        if (content !== undefined) return { content, revision: pinnedRevision }
      }
      return { content: record.content, revision: record.currentRevision }
    },
  }

  function requireTemplate(id: string) {
    const record = repository.findTemplateById(id)
    if (!record) {
      throw new AppError(ApiErrorCodes.AI_PROMPT_NOT_FOUND, 'Prompt 模板不存在', 404)
    }
  }

  function toTemplate(record: {
    id: string
    name: string
    description: string
    content: string
    enabled: boolean
    sortOrder: number
    createdAt: Date
    updatedAt: Date
  }): PromptTemplate {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      content: record.content,
      enabled: record.enabled,
      sortOrder: record.sortOrder,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }
}
