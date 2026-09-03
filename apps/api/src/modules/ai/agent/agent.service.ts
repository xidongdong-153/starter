import type {
  AiOutputContractRef,
  AgentDefinitionConfig,
  AgentDefinitionDetail,
  AgentDefinitionListQuery,
  AgentDefinitionSummary,
  AiToolRef,
  AiToolSummary,
  CreateAgentDefinitionInput,
  InlineAgentRunConfig,
  UpdateAgentDefinitionInput,
  UpdateAgentDefinitionStatusInput,
} from '@starter/contracts'
import { agentDefinitionConfigSchema, ApiErrorCodes, defaultAgentDefinitionConfig } from '@starter/contracts'

import type { RuntimeAccessContext } from '../principal.js'
import type { AiToolRegistry, RegisteredAiTool } from '../tool/tool-registry.js'
import { isAiToolAvailableInScope } from '../tool/tool-registry.js'
import type { AiOutputContractRegistry, ResolvedAiOutputContract } from '../output/output-contract-registry.js'
import type { AiPromptService } from '../prompt/prompt.service.js'
import { appendSkillDescriptions } from '../skill/skill-tools.js'
import type { AiSkillRecord, AiSkillRepository } from '../skill/skill.repository.js'
import { AppError } from '@api/shared/app-error.js'
import { generateId } from '@api/shared/id.js'
import { sha256Hex } from '../run/resolved-manifest.js'

import { AiAgentDefinitionRevisionConflictError } from './agent.repository.js'
import type { AiAgentDefinitionRecord, AiAgentDefinitionRepository } from './agent.repository.js'
import { parseAgentDefinitionConfig, toAgentDefinitionDetail, toAgentDefinitionSummary } from './agent.presenter.js'

/**
 * Run 启动时固化的解析事实：资源版本引用与内容 hash。只含 revision 与
 * SHA-256，不含 Prompt 正文；内联文本只存 hash，不落库。
 */
export interface ResolvedAgentManifestFacts {
  systemPrompt: {
    promptId: string | null
    revision: number | null
    contentHash: string
    inline: boolean
  } | null
  skills: Array<{ skillId: string; revision: number; contentHash: string }>
}

/**
 * Run 启动时的执行配置解析结果。预设 Agent 启动时 id/revision 非空；
 * 内联配置启动时为 null，配置事实只存在 Run snapshot 里。
 */
export interface ResolvedAgentDefinition {
  id: string | null
  revision: number | null
  config: AgentDefinitionConfig
  model: NonNullable<AgentDefinitionConfig['model']>
  systemPrompt: string
  skills: Array<Pick<AiSkillRecord, 'id' | 'name' | 'description'>>
  tools: RegisteredAiTool[]
  outputContract: ResolvedAiOutputContract | null
  thinkingLevel: AgentDefinitionConfig['thinkingLevel']
  maxTurns: number
  /** resolved manifest 的组装输入；由 resolve/resolveInline 一并返回。 */
  manifestFacts: ResolvedAgentManifestFacts
}

export interface AiAgentDefinitionService {
  listPublic: (query: AgentDefinitionListQuery) => {
    items: AgentDefinitionSummary[]
    total: number
    page: number
    pageSize: number
  }
  getPublic: (id: string) => AgentDefinitionSummary
  listAdmin: (query: AgentDefinitionListQuery) => {
    items: AgentDefinitionDetail[]
    total: number
    page: number
    pageSize: number
  }
  getAdmin: (id: string) => AgentDefinitionDetail
  create: (input: CreateAgentDefinitionInput, actorId: string) => Promise<AgentDefinitionDetail>
  update: (id: string, input: UpdateAgentDefinitionInput, actorId: string) => Promise<AgentDefinitionDetail>
  updateStatus: (id: string, input: UpdateAgentDefinitionStatusInput, actorId: string) => Promise<AgentDefinitionDetail>
  resolve: (id: string, access: RuntimeAccessContext) => Promise<ResolvedAgentDefinition>
  /** 内联配置解析：不经过 ai_agent_definitions，校验规则与 resolve 一致。 */
  resolveInline: (config: InlineAgentRunConfig, access: RuntimeAccessContext) => Promise<ResolvedAgentDefinition>
  listTools: () => AiToolSummary[]
}

export function createAiAgentDefinitionService(input: {
  repository: AiAgentDefinitionRepository
  resolveModel: (
    model: NonNullable<AgentDefinitionConfig['model']>,
  ) => Promise<NonNullable<AgentDefinitionConfig['model']>>
  promptService: AiPromptService
  skillRepository: AiSkillRepository
  toolRegistry: AiToolRegistry
  outputContractRegistry: AiOutputContractRegistry
}): AiAgentDefinitionService {
  const { repository, resolveModel, promptService, skillRepository, toolRegistry, outputContractRegistry } = input

  /** config 引用资源的当前 revision 记录；资源校验已由 validateConfig 保证。 */
  const configResourceRevisions = (config: AgentDefinitionConfig) =>
    makeConfigResourceRevisions(config, promptService, skillRepository)

  function listPublic(query: AgentDefinitionListQuery) {
    const result = repository.list({ ...query, status: 'enabled' })
    return {
      items: result.items.map(toAgentDefinitionSummary),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  function getPublic(id: string): AgentDefinitionSummary {
    const record = requireRecord(id)
    if (record.status !== 'enabled') throw notFound()
    return toAgentDefinitionSummary(record)
  }

  function listAdmin(query: AgentDefinitionListQuery) {
    const result = repository.list(query)
    return {
      items: result.items.map(toAgentDefinitionDetail),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  function getAdmin(id: string): AgentDefinitionDetail {
    return toAgentDefinitionDetail(requireRecord(id))
  }

  async function create(input: CreateAgentDefinitionInput, actorId: string): Promise<AgentDefinitionDetail> {
    const config = normalizeConfig(input.config ?? defaultAgentDefinitionConfig)
    await validateConfig(config, false)
    const revisions = configResourceRevisions(config)
    try {
      const record = repository.create({
        id: generateId(),
        name: input.name,
        description: input.description ?? '',
        configJson: JSON.stringify(config),
        systemPromptRevision: revisions.systemPromptRevision,
        skillRevisionsJson: revisions.skillRevisionsJson,
        createdBy: actorId,
        updatedBy: actorId,
        now: new Date(),
      })
      return toAgentDefinitionDetail(record)
    } catch (error) {
      throw normalizeRepositoryError(error)
    }
  }

  async function update(
    id: string,
    input: UpdateAgentDefinitionInput,
    actorId: string,
  ): Promise<AgentDefinitionDetail> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = requireRecord(id)
      const currentConfig = parseAgentDefinitionConfig(current.configJson)
      const nextConfig = input.config ? normalizeConfig(input.config) : currentConfig
      const configChanged = !sameConfig(currentConfig, nextConfig)
      if (input.config && configChanged) await validateConfig(nextConfig, current.status === 'enabled')
      // config 变化时记录新引用资源的当前 revision；不变时保留既有记录列，
      // 资源更新已由传播路径同步刷新过。
      const revisions = configChanged ? configResourceRevisions(nextConfig) : null

      try {
        const record = repository.update({
          id,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(configChanged ? { configJson: JSON.stringify(nextConfig) } : {}),
          ...(revisions ? { systemPromptRevision: revisions.systemPromptRevision } : {}),
          ...(revisions ? { skillRevisionsJson: revisions.skillRevisionsJson } : {}),
          expectedRevision: current.revision,
          expectedStatus: current.status,
          revision: current.revision + (configChanged ? 1 : 0),
          updatedBy: actorId,
          now: new Date(),
        })
        if (!record) throw notFound()
        return toAgentDefinitionDetail(record)
      } catch (error) {
        if (error instanceof AiAgentDefinitionRevisionConflictError) {
          if (attempt < 2) continue
          throw new AppError(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, 'Agent 更新冲突，请重试', 500)
        }
        throw normalizeRepositoryError(error)
      }
    }

    throw new AppError(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, 'Agent 更新冲突，请重试', 500)
  }

  async function updateStatus(
    id: string,
    input: UpdateAgentDefinitionStatusInput,
    actorId: string,
  ): Promise<AgentDefinitionDetail> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = requireRecord(id)
      if (input.status === 'enabled') {
        await validateConfig(parseAgentDefinitionConfig(current.configJson), true)
      }
      try {
        const record = repository.updateStatus({
          id,
          status: input.status,
          expectedRevision: current.revision,
          expectedStatus: current.status,
          updatedBy: actorId,
          now: new Date(),
        })
        if (!record) throw notFound()
        return toAgentDefinitionDetail(record)
      } catch (error) {
        if (error instanceof AiAgentDefinitionRevisionConflictError) {
          if (attempt < 2) continue
          throw new AppError(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, 'Agent 状态更新冲突，请重试', 500)
        }
        throw error
      }
    }

    throw new AppError(ApiErrorCodes.SYSTEM_INTERNAL_ERROR, 'Agent 状态更新冲突，请重试', 500)
  }

  async function resolve(id: string, access: RuntimeAccessContext): Promise<ResolvedAgentDefinition> {
    const record = requireRecord(id)
    if (record.status !== 'enabled') {
      throw new AppError(ApiErrorCodes.AI_AGENT_NOT_ENABLED, 'Agent 当前未启用', 409)
    }
    const config = parseAgentDefinitionConfig(record.configJson)
    const model = config.model
    const systemPromptId = config.systemPromptId
    if (!model || !systemPromptId) throw invalidConfig()
    let core: ResolvedConfigCore
    try {
      core = await resolveConfigCore(
        {
          model,
          systemPromptId,
          systemPromptText: null,
          systemPromptRevision: record.systemPromptRevision,
          skillIds: config.skillIds,
          skillRevisions: parseSkillRevisionsRecord(record.skillRevisionsJson),
          toolRefs: config.toolRefs,
          outputContract: config.outputContract,
        },
        access,
      )
    } catch (error) {
      // 预设 Agent 路径维持既有错误语义：模型引用无效统一 400，不泄漏 allowlist 判据。
      // 技能/工具/契约的 AppError 原样传播，错误码与资源信息不变。
      if (error instanceof AppError && error.code === ApiErrorCodes.AI_MODEL_NOT_ALLOWED) {
        throw invalidConfig('model')
      }
      throw error
    }
    return {
      id: record.id,
      revision: record.revision,
      config,
      ...core,
      thinkingLevel: config.thinkingLevel,
      maxTurns: config.maxTurns,
    }
  }

  async function resolveInline(
    input: InlineAgentRunConfig,
    access: RuntimeAccessContext,
  ): Promise<ResolvedAgentDefinition> {
    if (access.principal.kind === 'product_app') {
      throw new AppError(ApiErrorCodes.AI_RUN_INLINE_CONFIG_FORBIDDEN, '应用凭据主体不能使用内联 Agent 配置', 403)
    }
    const core = await resolveConfigCore(
      {
        model: input.model,
        systemPromptId: input.systemPromptId ?? null,
        systemPromptText: input.systemPrompt ?? null,
        systemPromptRevision: null,
        skillIds: input.skillIds,
        skillRevisions: null,
        toolRefs: input.toolRefs,
        outputContract: input.outputContract,
      },
      access,
    )
    const config: AgentDefinitionConfig = {
      schemaVersion: 2,
      model: core.model,
      systemPromptId: input.systemPromptId ?? null,
      skillIds: input.skillIds,
      toolRefs: input.toolRefs,
      outputContract: input.outputContract,
      outputMode: input.outputMode,
      thinkingLevel: input.thinkingLevel,
      maxTurns: input.maxTurns,
      ...(input.retryPolicy ? { retryPolicy: input.retryPolicy } : {}),
    }
    return {
      id: null,
      revision: null,
      config,
      ...core,
      thinkingLevel: input.thinkingLevel,
      maxTurns: input.maxTurns,
    }
  }

  /**
   * 预设 Agent 与内联配置共用的解析核心：模型 allowlist、系统提示词、
   * 技能启用、工具 scope、输出契约元数据。模型不在 allowlist 时抛
   * AI_MODEL_NOT_ALLOWED（403），由预设路径决定是否改写错误码。
   *
   * manifest facts：预设 Agent 按 Agent 行记录的 pinned revision 读不可变
   * revision 行内容（保证同一 Agent revision 解析出同一 hash）；内联配置
   * 读当前值。revision 行缺失（绕过 repository 写入的数据）回退主表当前值。
   */
  async function resolveConfigCore(
    input: {
      model: NonNullable<AgentDefinitionConfig['model']>
      systemPromptId: string | null
      systemPromptText: string | null
      /** 预设 Agent 的 pinned Prompt revision；内联为 null。 */
      systemPromptRevision: number | null
      skillIds: string[]
      /** 预设 Agent 的 pinned Skill revision 映射；内联为 null。 */
      skillRevisions: Record<string, number> | null
      toolRefs: AiToolRef[]
      outputContract: AiOutputContractRef | null
    },
    access: RuntimeAccessContext,
  ): Promise<ResolvedConfigCore> {
    const model = await resolveModel(input.model)
    let rawSystemPrompt: string
    let systemPromptFacts: ResolvedAgentManifestFacts['systemPrompt']
    if (input.systemPromptText !== null) {
      rawSystemPrompt = input.systemPromptText
      systemPromptFacts = {
        promptId: null,
        revision: null,
        contentHash: sha256Hex(input.systemPromptText),
        inline: true,
      }
    } else if (input.systemPromptId !== null) {
      const resolved = promptService.resolveSystemPromptForManifest(input.systemPromptId, input.systemPromptRevision)
      if (!resolved || resolved.content.length === 0) throw invalidConfig('systemPrompt')
      rawSystemPrompt = resolved.content
      systemPromptFacts = {
        promptId: input.systemPromptId,
        revision: resolved.revision,
        contentHash: sha256Hex(resolved.content),
        inline: false,
      }
    } else {
      throw invalidConfig('systemPrompt')
    }
    const skillFacts: ResolvedAgentManifestFacts['skills'] = []
    const skills = input.skillIds.map((id) => {
      const skill = skillRepository.findSkillById(id)
      if (!skill || !skill.enabled) throw invalidConfig('skill')
      const pinned = input.skillRevisions?.[id] ?? null
      let revision = skill.currentRevision
      let content = skill.content
      if (pinned !== null) {
        const revisionContent = skillRepository.findSkillRevisionContent(id, pinned)
        if (revisionContent !== undefined) {
          revision = pinned
          content = revisionContent
        }
      }
      skillFacts.push({
        skillId: skill.id,
        revision,
        contentHash: sha256Hex(content),
      })
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
      }
    })
    const systemPrompt = appendSkillDescriptions(rawSystemPrompt, skills) ?? rawSystemPrompt
    // 精确 ref 必须存在，且同一配置不能引用同名不同版本
    // （Pi 模型调用只携带 Tool name，没有第二个版本选择字段）。
    const toolNames = new Set<string>()
    const tools = input.toolRefs.map((ref) => {
      if (toolNames.has(ref.name) || ref.name === 'emit_structured_output') throw invalidConfig('tool')
      toolNames.add(ref.name)
      const tool = toolRegistry.find(ref)
      if (!tool || !isAiToolAvailableInScope(tool, access.scope)) {
        throw invalidConfig('tool')
      }
      return tool
    })
    const outputContract = input.outputContract ? resolveOutputContract(input.outputContract) : null
    return {
      model,
      systemPrompt,
      skills,
      tools,
      outputContract,
      manifestFacts: { systemPrompt: systemPromptFacts, skills: skillFacts },
    }
  }

  async function validateConfig(config: AgentDefinitionConfig, requireExecutable: boolean): Promise<void> {
    if (config.model) {
      try {
        await resolveModel(config.model)
      } catch (error) {
        if (error instanceof AppError) throw invalidConfig('model')
        throw error
      }
    } else if (requireExecutable) {
      throw invalidConfig('model')
    }

    if (config.systemPromptId) {
      try {
        promptService.assertSystemPromptAvailable(config.systemPromptId)
      } catch (error) {
        if (error instanceof AppError) throw invalidConfig('systemPrompt')
        throw error
      }
    } else if (requireExecutable) {
      throw invalidConfig('systemPrompt')
    }

    for (const skillId of config.skillIds) {
      const skill = skillRepository.findSkillById(skillId)
      if (!skill || !skill.enabled) throw invalidConfig('skill')
    }
    // 精确 ref 必须存在，且同一个 Agent 不能引用同名不同版本
    // （Pi 模型调用只携带 Tool name，没有第二个版本选择字段）。
    const toolNames = new Set<string>()
    for (const ref of config.toolRefs) {
      if (toolNames.has(ref.name) || ref.name === 'emit_structured_output') throw invalidConfig('tool')
      toolNames.add(ref.name)
      try {
        toolRegistry.require(ref)
      } catch {
        throw invalidConfig('tool')
      }
    }
    if (config.outputContract) resolveOutputContract(config.outputContract)
  }

  function resolveOutputContract(ref: AiOutputContractRef): ResolvedAiOutputContract {
    try {
      const contract = outputContractRegistry.resolve(ref)
      if (
        contract.schemaHash !== ref.schemaHash ||
        contract.renderKind !== ref.renderKind ||
        contract.visibility !== ref.visibility ||
        contract.mode !== ref.mode
      ) {
        throw new Error('Output Contract ref metadata mismatch')
      }
      return contract
    } catch {
      throw invalidConfig('outputContract')
    }
  }

  function requireRecord(id: string): AiAgentDefinitionRecord {
    const record = repository.findById(id)
    if (!record) throw notFound()
    return record
  }

  function listTools(): AiToolSummary[] {
    return [...toolRegistry.listPublic()]
  }

  return {
    listPublic,
    getPublic,
    listAdmin,
    getAdmin,
    create,
    update,
    updateStatus,
    resolve,
    resolveInline,
    listTools,
  }
}

interface ResolvedConfigCore {
  model: NonNullable<AgentDefinitionConfig['model']>
  systemPrompt: string
  skills: Array<Pick<AiSkillRecord, 'id' | 'name' | 'description'>>
  tools: RegisteredAiTool[]
  outputContract: ResolvedAiOutputContract | null
  manifestFacts: ResolvedAgentManifestFacts
}

function normalizeConfig(config: AgentDefinitionConfig): AgentDefinitionConfig {
  const parsed = agentDefinitionConfigSchema.safeParse(config)
  if (!parsed.success) throw invalidConfig()
  return {
    ...parsed.data,
    skillIds: [...parsed.data.skillIds].sort(),
    toolRefs: [...parsed.data.toolRefs].sort((left, right) =>
      left.name === right.name ? left.version.localeCompare(right.version) : left.name.localeCompare(right.name),
    ),
  }
}

function sameConfig(left: AgentDefinitionConfig, right: AgentDefinitionConfig): boolean {
  const normalizedLeft = normalizeConfig(left)
  const normalizedRight = normalizeConfig(right)
  const modelsEqual =
    normalizedLeft.model === null || normalizedRight.model === null
      ? normalizedLeft.model === normalizedRight.model
      : normalizedLeft.model.providerId === normalizedRight.model.providerId &&
        normalizedLeft.model.modelId === normalizedRight.model.modelId

  return (
    normalizedLeft.schemaVersion === normalizedRight.schemaVersion &&
    modelsEqual &&
    normalizedLeft.systemPromptId === normalizedRight.systemPromptId &&
    sameStringArray(normalizedLeft.skillIds, normalizedRight.skillIds) &&
    sameToolRefs(normalizedLeft.toolRefs, normalizedRight.toolRefs) &&
    normalizedLeft.thinkingLevel === normalizedRight.thinkingLevel &&
    normalizedLeft.maxTurns === normalizedRight.maxTurns &&
    sameOutputContractRefs(normalizedLeft.outputContract, normalizedRight.outputContract) &&
    normalizedLeft.outputMode === normalizedRight.outputMode &&
    (normalizedLeft.retryPolicy?.maxAttempts ?? 1) === (normalizedRight.retryPolicy?.maxAttempts ?? 1)
  )
}

function sameOutputContractRefs(left: AiOutputContractRef | null, right: AiOutputContractRef | null): boolean {
  if (left === null || right === null) return left === right
  return (
    left.name === right.name &&
    left.version === right.version &&
    left.schemaHash === right.schemaHash &&
    left.renderKind === right.renderKind &&
    left.visibility === right.visibility &&
    left.mode === right.mode
  )
}

function sameToolRefs(left: AiToolRef[], right: AiToolRef[]): boolean {
  return (
    left.length === right.length &&
    left.every((ref, index) => {
      const other = right[index]
      return other !== undefined && ref.name === other.name && ref.version === other.version
    })
  )
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Agent 行的 skill_revisions_json 解析；空值或非法 JSON 返回 null。 */
function parseSkillRevisionsRecord(skillRevisionsJson: string | null): Record<string, number> | null {
  if (!skillRevisionsJson) return null
  try {
    const parsed = JSON.parse(skillRevisionsJson) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'number') return null
      result[key] = value
    }
    return result
  } catch {
    return null
  }
}

/** config 引用资源的当前 revision 记录；资源缺失或未启用按配置无效抛出。 */
function makeConfigResourceRevisions(
  config: AgentDefinitionConfig,
  promptService: AiPromptService,
  skillRepository: AiSkillRepository,
): { systemPromptRevision: number | null; skillRevisionsJson: string | null } {
  let systemPromptRevision: number | null = null
  if (config.systemPromptId) {
    systemPromptRevision = promptService.getSystemPromptRevision(config.systemPromptId)
    if (systemPromptRevision === null) throw invalidConfig('systemPrompt')
  }
  const skillRevisions: Record<string, number> = {}
  for (const skillId of config.skillIds) {
    const skill = skillRepository.findSkillById(skillId)
    if (!skill || !skill.enabled) throw invalidConfig('skill')
    skillRevisions[skillId] = skill.currentRevision
  }
  return {
    systemPromptRevision,
    skillRevisionsJson: Object.keys(skillRevisions).length > 0 ? JSON.stringify(skillRevisions) : null,
  }
}

function invalidConfig(resource?: string): AppError {
  return new AppError(
    ApiErrorCodes.AI_AGENT_CONFIG_INVALID,
    'Agent 配置引用无效或资源未启用',
    400,
    resource ? { resource } : undefined,
  )
}

function notFound(): AppError {
  return new AppError(ApiErrorCodes.COMMON_NOT_FOUND, 'Agent 不存在', 404)
}

function normalizeRepositoryError(error: unknown): unknown {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AiAgentDefinitionNameConflictError') {
    return new AppError(ApiErrorCodes.AI_AGENT_NAME_CONFLICT, 'Agent 名称已存在', 409)
  }
  return error
}
