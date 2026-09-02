import { ApiErrorCodes } from '@starter/contracts'
import type { AiSkill, AiSkillSummary, CreateAiSkillInput, UpdateAiSkillInput } from '@starter/contracts'

import { AppError } from '@api/shared/app-error.js'
import { generateId } from '@api/shared/id.js'

import type { AiSkillDescription, AiSkillRecord, AiSkillRepository } from './skill.repository.js'

export interface AiSkillService {
  listSkills: () => AiSkillSummary[]
  getSkill: (id: string) => AiSkill
  createSkill: (input: CreateAiSkillInput, actorId: string) => AiSkill
  updateSkill: (id: string, input: UpdateAiSkillInput, actorId: string) => AiSkill
  deleteSkill: (id: string) => boolean
  listEnabledDescriptions: () => AiSkillDescription[]
}

export function createAiSkillService(repository: AiSkillRepository): AiSkillService {
  function requireSkill(id: string): AiSkillRecord {
    const record = repository.findSkillById(id)
    if (!record) {
      throw new AppError(ApiErrorCodes.AI_SKILL_NOT_FOUND, '技能不存在', 404)
    }
    return record
  }

  function toSummary(record: AiSkillRecord): AiSkillSummary {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      enabled: record.enabled,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }

  function toDetail(record: AiSkillRecord): AiSkill {
    return { ...toSummary(record), content: record.content }
  }

  return {
    listSkills() {
      return repository.listSkills().map(toSummary)
    },
    getSkill(id) {
      return toDetail(requireSkill(id))
    },
    createSkill(input, actorId) {
      const now = new Date()
      const record = repository.createSkill({
        id: generateId(),
        name: input.name,
        description: input.description,
        content: input.content,
        enabled: input.enabled ?? true,
        actorId,
        now,
      })
      return toDetail(record)
    },
    updateSkill(id, input, actorId) {
      requireSkill(id)
      const record = repository.updateSkill({
        id,
        name: input.name,
        description: input.description,
        content: input.content,
        enabled: input.enabled,
        actorId,
        now: new Date(),
      })
      return toDetail(record!)
    },
    deleteSkill(id) {
      requireSkill(id)
      return repository.deleteSkill(id)
    },
    listEnabledDescriptions() {
      return repository.listEnabledDescriptions()
    },
  }
}
