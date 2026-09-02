import { PermissionKeys, type AiToolRef, type AiToolSummary, type Permission } from '@starter/contracts'
import { z, type ZodType } from 'zod'
import type { PrincipalContext, ResourceScope } from '@api/modules/ai/principal.js'

export interface AiToolExecutionContext {
  principal: PrincipalContext
  scope: ResourceScope
  requestId: string
  signal: AbortSignal
  reportProgress: (safeSummary: string) => void
  /**
   * 上报一条引用来源，服务端校验通过后发布 `source.available`。
   *
   * 可选字段，工具内部用 `?.` 调用；内容不进 `modelText`、不产生审计记录，
   * 非法 source（schema 不合法、URL 不安全）被丢弃，不影响 Tool 结果。
   */
  reportSource?: (source: AiToolSourceInput) => void
  runId?: string
  turnId?: string | null
  stepId?: string | null
  modelCallId?: string | null
  toolCallId?: string
  toolExecutionId?: string | null
  turnIndex?: number | null
}

/** 工具上报 source 的输入；`uri` 和 `excerpt` 省略时按 null 处理。 */
export interface AiToolSourceInput {
  sourceId: string
  kind: string
  title: string
  uri?: string | null
  excerpt?: string | null
}

export interface AiToolResult {
  modelText: string
  safeSummary: string | null
  terminate?: boolean
  structuredOutputId?: string
}

export type AiToolScope = 'platform' | { tenantId: string; projectId: string }

export interface AiToolDefinitionInput<TInput> {
  name: string
  version: string
  description: string
  inputSchema: ZodType<TInput>
  timeoutMs: number
  scope: AiToolScope
  requiredPermission: Permission | null
  internal?: boolean
  execute: (context: AiToolExecutionContext, input: TInput) => Promise<AiToolResult>
}

export interface RegisteredAiTool {
  name: string
  version: string
  description: string
  inputSchema: ZodType<unknown>
  timeoutMs: number
  scope: AiToolScope
  requiredPermission: Permission | null
  internal?: boolean
  execute: (context: AiToolExecutionContext, input: unknown) => Promise<AiToolResult>
}

/**
 * 执行查找只接受精确 `{ name, version }`。
 * 不提供无版本查找，不允许隐式选择同名工具的任意版本。
 */
export interface AiToolRegistry {
  list: () => readonly RegisteredAiTool[]
  find: (ref: AiToolRef) => RegisteredAiTool | undefined
  require: (ref: AiToolRef) => RegisteredAiTool
  /** 只投影公开元数据，不暴露 inputSchema、execute 或可变内部对象。 */
  listPublic: () => readonly AiToolSummary[]
}

export function defineAiTool<TInput>(input: AiToolDefinitionInput<TInput>): RegisteredAiTool {
  validateToolDefinition(input)
  return Object.freeze({
    name: input.name,
    version: input.version,
    description: input.description,
    inputSchema: input.inputSchema as ZodType<unknown>,
    timeoutMs: input.timeoutMs,
    scope: input.scope,
    requiredPermission: input.requiredPermission,
    internal: input.internal,
    execute: (context: AiToolExecutionContext, value: unknown) => input.execute(context, value as TInput),
  })
}

export function createAiToolRegistry(tools: readonly RegisteredAiTool[]): AiToolRegistry {
  const byRef = new Map<string, RegisteredAiTool>()
  const byName = new Map<string, RegisteredAiTool[]>()
  for (const tool of tools) {
    validateToolDefinition(tool)
    const key = toolRefKey(tool)
    if (byRef.has(key)) throw new Error(`重复的 AI 工具版本: ${key}`)
    byRef.set(key, Object.freeze({ ...tool }))
    const versioned = byName.get(tool.name) ?? []
    versioned.push(tool)
    byName.set(tool.name, versioned)
  }
  return Object.freeze({
    list: () => [...byRef.values()],
    find: (ref: AiToolRef) => byRef.get(toolRefKey(ref)),
    require: (ref: AiToolRef) => {
      const tool = byRef.get(toolRefKey(ref))
      if (!tool) throw new Error(`AI 工具未注册: ${toolRefKey(ref)}`)
      return tool
    },
    listPublic: () =>
      [...byRef.values()].map(({ name, version, description, scope }) => ({
        name,
        version,
        description,
        scope,
      })),
  })
}

export function isAiToolAvailableInScope(tool: RegisteredAiTool, scope: ResourceScope): boolean {
  return (
    tool.scope === 'platform' || (tool.scope.tenantId === scope.tenantId && tool.scope.projectId === scope.projectId)
  )
}

/** Registry 内部 canonical key；只用于 Map 索引，不进入公开 DTO。 */
function toolRefKey(tool: { name: string; version: string }): string {
  return `${tool.name}@${tool.version}`
}

function validateToolDefinition(
  tool: Pick<
    RegisteredAiTool,
    'name' | 'version' | 'description' | 'inputSchema' | 'timeoutMs' | 'scope' | 'requiredPermission' | 'internal'
  >,
): void {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(tool.name)) {
    throw new Error(`AI 工具名称无效: ${tool.name}`)
  }
  if (tool.name === 'emit_structured_output' && !tool.internal) {
    throw new Error('AI 工具名称保留给 Structured Output')
  }
  if (!/^\d+\.\d+\.\d+$/.test(tool.version)) {
    throw new Error(`AI 工具版本无效: ${tool.name}`)
  }
  if (tool.description.trim().length === 0 || tool.description.length > 1000) {
    throw new Error(`AI 工具描述无效: ${tool.name}`)
  }
  if (!Number.isInteger(tool.timeoutMs) || tool.timeoutMs < 100 || tool.timeoutMs > 30_000) {
    throw new Error(`AI 工具超时无效: ${tool.name}`)
  }
  if (tool.scope !== 'platform' && (!tool.scope.tenantId || !tool.scope.projectId)) {
    throw new Error(`AI 工具范围无效: ${tool.name}`)
  }
  if (tool.requiredPermission !== null && !Object.values(PermissionKeys).includes(tool.requiredPermission)) {
    throw new Error(`AI 工具权限无效: ${tool.name}`)
  }
  const schema = z.toJSONSchema(tool.inputSchema, { target: 'draft-7' })
  if (schema.type !== 'object') throw new Error(`AI 工具参数必须是 object schema: ${tool.name}`)
}
