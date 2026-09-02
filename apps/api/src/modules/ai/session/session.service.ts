import type { Logger } from 'pino'
import type { Entry } from '@earendil-works/pi-agent-core'
import type {
  AgentSession,
  AgentSessionListQuery,
  AgentTranscript,
  AgentTranscriptQuery,
  CreateAgentSessionInput,
  UpdateAgentSessionInput,
} from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'

import type { AgentSessionStore } from '@api/infra/agent/index.js'
import type { RuntimeAccessContext } from '@api/modules/ai/principal.js'
import type { AiOutputContractRegistry } from '@api/modules/ai/output/output-contract-registry.js'
import { toStructuredOutputContractRef } from '@api/modules/ai/output/output-contract-registry.js'
import type { AiStructuredOutputRepository } from '@api/modules/ai/output/structured-output.repository.js'
import { AppError } from '@api/shared/app-error.js'
import { generateId } from '@api/shared/id.js'

import {
  collectStructuredOutputIds,
  projectTranscript,
  toAgentSession,
  type TranscriptStructuredOutput,
} from './session.presenter.js'
import type { AiAgentSessionRepository } from './session.repository.js'

export interface SessionConsistencyReport {
  missingInPi: string[]
  missingInMain: string[]
}

export interface AiAgentSessionService {
  create: (input: CreateAgentSessionInput, access: RuntimeAccessContext, requestId?: string) => Promise<AgentSession>
  list: (
    access: RuntimeAccessContext,
    query: AgentSessionListQuery,
  ) => { items: AgentSession[]; total: number; page: number; pageSize: number }
  get: (access: RuntimeAccessContext, sessionId: string) => AgentSession
  update: (access: RuntimeAccessContext, sessionId: string, input: UpdateAgentSessionInput) => Promise<AgentSession>
  archive: (access: RuntimeAccessContext, sessionId: string) => AgentSession
  transcript: (
    access: RuntimeAccessContext,
    sessionId: string,
    query: AgentTranscriptQuery,
    requestId?: string,
  ) => Promise<AgentTranscript>
  checkConsistency: () => Promise<SessionConsistencyReport>
}

export function createAiAgentSessionService(input: {
  repository: AiAgentSessionRepository
  sessionStore: AgentSessionStore
  logger: Logger
  /** transcript 回放结构化输出需要；未提供时不注入 structuredOutput 字段。 */
  structuredOutputRepository?: AiStructuredOutputRepository
  outputContractRegistry?: AiOutputContractRegistry
}): AiAgentSessionService {
  const { repository, sessionStore, logger } = input
  const structuredOutputRepository = input.structuredOutputRepository
  const outputContractRegistry = input.outputContractRegistry

  async function assertDefaultAgent(id: string | null): Promise<void> {
    if (id === null) return
    const status = repository.findDefaultAgentStatus(id)
    if (status === 'missing') {
      throw new AppError(ApiErrorCodes.COMMON_INVALID_REQUEST, 'defaultAgentId 引用的 Agent 不存在', 400)
    }
    if (status !== 'enabled') {
      throw new AppError(ApiErrorCodes.AI_AGENT_NOT_ENABLED, 'defaultAgentId 必须引用已启用的 Agent', 409)
    }
  }

  function requireActiveSession(access: RuntimeAccessContext, sessionId: string) {
    const record = repository.findInScope(sessionId, access)
    if (!record || record.archivedAt !== null) throw notFound()
    return record
  }

  function notFound(): AppError {
    return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, '资源不存在', 404)
  }

  async function create(
    input: CreateAgentSessionInput,
    access: RuntimeAccessContext,
    requestId?: string,
  ): Promise<AgentSession> {
    const title = input.title ?? '新会话'
    const defaultAgentId = input.defaultAgentId ?? null
    await assertDefaultAgent(defaultAgentId)
    const id = generateId()
    try {
      await sessionStore.createSession({ id })
    } catch (cause) {
      logger.error({ err: cause, sessionId: id, requestId }, 'Agent Session 创建失败')
      throw new AppError(ApiErrorCodes.AI_SESSION_STORAGE_FAILED, 'Agent Session 创建失败', 500)
    }
    try {
      const record = repository.create({
        id,
        access,
        title,
        defaultAgentId,
        now: new Date(),
      })
      return toAgentSession(record)
    } catch (cause) {
      try {
        await sessionStore.deleteSession(id)
      } catch (deleteError) {
        logger.error(
          { err: deleteError, sessionId: id, requestId },
          'Agent Session 创建补偿删除失败，存在孤儿 Pi Session',
        )
      }
      logger.error({ err: cause, sessionId: id, requestId }, 'Agent Session 主库索引写入失败')
      throw new AppError(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, '创建 Agent Session 失败', 500)
    }
  }

  function list(access: RuntimeAccessContext, query: AgentSessionListQuery) {
    const result = repository.listActiveInScope(access, query.page, query.pageSize)
    return {
      items: result.items.map(toAgentSession),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  function get(access: RuntimeAccessContext, sessionId: string): AgentSession {
    return toAgentSession(requireActiveSession(access, sessionId))
  }

  async function update(
    access: RuntimeAccessContext,
    sessionId: string,
    input: UpdateAgentSessionInput,
  ): Promise<AgentSession> {
    requireActiveSession(access, sessionId)
    if (input.defaultAgentId !== undefined) await assertDefaultAgent(input.defaultAgentId)
    const record = repository.updateInScope({
      id: sessionId,
      access,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.defaultAgentId !== undefined ? { defaultAgentId: input.defaultAgentId } : {}),
      now: new Date(),
    })
    if (!record) throw notFound()
    return toAgentSession(record)
  }

  function archive(access: RuntimeAccessContext, sessionId: string): AgentSession {
    const result = repository.archiveInScope(sessionId, access, new Date())
    if (result.status === 'not_found') throw notFound()
    return toAgentSession(result.record)
  }

  /**
   * 取回本页 toolResult entry 引用的结构化输出，value 按可见性打码
   * （product 才带值，与 run 模块 structured-outputs 路由一致）。
   * visibility/mode 取表内值（emit 时刻的事实），历史 NULL 行回退 registry
   * 当前定义；两者都拿不到的条目跳过并记 WARN，对应 item 不带 structuredOutput
   * 字段。contract ref 组装与 run 模块共用 toStructuredOutputContractRef。
   */
  function readStructuredOutputsForTranscript(
    entries: readonly Entry[],
    sessionId: string,
    requestId?: string,
  ): Map<string, TranscriptStructuredOutput> | undefined {
    if (!structuredOutputRepository || !outputContractRegistry) return undefined
    const ids = collectStructuredOutputIds(entries)
    if (ids.length === 0) return undefined
    const outputs = new Map<string, TranscriptStructuredOutput>()
    for (const record of structuredOutputRepository.findByIds(ids)) {
      const contract = outputContractRegistry.find({
        name: record.contractName,
        version: record.contractVersion,
      })
      const ref = toStructuredOutputContractRef(record, contract)
      if (!ref) {
        logger.warn(
          {
            sessionId,
            requestId,
            referenceId: record.id,
            contractName: record.contractName,
            contractVersion: record.contractVersion,
          },
          'Structured Output 无法渲染（contract 已移除且无表内可见性），transcript 跳过该条',
        )
        continue
      }
      outputs.set(record.id, {
        contract: ref,
        value: ref.visibility === 'product' ? record.value : null,
      })
    }
    return outputs
  }

  async function transcript(
    access: RuntimeAccessContext,
    sessionId: string,
    query: AgentTranscriptQuery,
    requestId?: string,
  ): Promise<AgentTranscript> {
    requireActiveSession(access, sessionId)
    const backward = query.direction === 'backward'
    let entries
    try {
      entries = await sessionStore.readTranscript({
        sessionId,
        lane: query.lane,
        cursor: query.cursor,
        limit: query.limit + 1,
        order: backward ? 'newestFirst' : 'oldestFirst',
      })
    } catch (cause) {
      logger.error({ err: cause, sessionId, requestId }, 'Agent Session transcript 读取失败')
      throw new AppError(ApiErrorCodes.AI_SESSION_STORAGE_FAILED, 'Agent Session 读取失败', 500)
    }
    const hasMore = entries.length > query.limit
    const pageEntries = hasMore ? entries.slice(0, query.limit) : entries
    const visibleEntries = backward ? [...pageEntries].reverse() : pageEntries
    const structuredOutputs = readStructuredOutputsForTranscript(visibleEntries, sessionId, requestId)
    const items = projectTranscript(
      visibleEntries,
      query.lane,
      (info) => logger.warn({ ...info, sessionId, requestId }, 'Agent transcript 跳过不可投影 entry'),
      structuredOutputs,
    )
    const cursorEntry = backward ? visibleEntries[0] : visibleEntries[visibleEntries.length - 1]
    const nextCursor = hasMore && cursorEntry !== undefined ? cursorEntry.seq : null
    return { items, nextCursor }
  }

  async function checkConsistency(): Promise<SessionConsistencyReport> {
    const mainIds = new Set(repository.listAllIds())
    let piIds: string[]
    try {
      piIds = await sessionStore.listSessions()
    } catch (cause) {
      logger.error({ err: cause }, 'Agent Session 一致性检查失败')
      throw cause
    }
    const piSet = new Set(piIds)
    return {
      missingInPi: [...mainIds].filter((id) => !piSet.has(id)),
      missingInMain: piIds.filter((id) => !mainIds.has(id)),
    }
  }

  return { create, list, get, update, archive, transcript, checkConsistency }
}
