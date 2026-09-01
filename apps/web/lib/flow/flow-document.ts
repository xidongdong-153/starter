import { agentThinkingLevelSchema } from '@starter/contracts'
import type { AgentThinkingLevel, AiToolRef } from '@starter/contracts'
import { z } from 'zod'

/**
 * Flow 流程文档：React Flow 的节点和边直接持久化，localStorage 是唯一存储。
 * 纯数据模块，不碰 React 和 DOM；Storage 通过参数注入，方便 node 环境测试。
 */

export interface FlowXY {
  x: number
  y: number
}

const flowXYSchema = z.strictObject({ x: z.number(), y: z.number() })

/** 输入节点：起点输入直接存在节点里，运行时从这里取值。 */
export interface FlowInputNodeData {
  inputText: string
}

/** 模型引用：provider + model，来自 `GET /api/ai/models`。 */
export interface FlowModelRef {
  providerId: string
  modelId: string
}

/**
 * 自定义节点的内联配置（编辑态）：model 和 systemPrompt 允许未填，
 * 运行前校验会拦；启动时转成契约的 InlineAgentRunConfig。
 */
export interface FlowAgentInlineConfig {
  model: FlowModelRef | null
  systemPrompt: string
  thinkingLevel: AgentThinkingLevel
  maxTurns: number
  toolRefs: AiToolRef[]
  skillIds: string[]
}

/** 默认内联配置：切到自定义模式时写入。 */
export function createFlowAgentInlineConfig(): FlowAgentInlineConfig {
  return {
    model: null,
    systemPrompt: '',
    thinkingLevel: 'off',
    maxTurns: 8,
    toolRefs: [],
    skillIds: [],
  }
}

/**
 * Agent 节点：config 字段存在时为自定义模式（忽略 agentId），
 * 不存在时为预设 Agent 模式（agentId 为空表示还没选，运行前校验会拦）。
 * name 是节点自定义名称：空串合法，画布回落显示链上序号。
 */
export interface FlowAgentNodeData {
  name: string
  agentId: string
  promptTemplate: string
  config?: FlowAgentInlineConfig
}

export type FlowNode =
  | { id: string; type: 'input'; position: FlowXY; data: FlowInputNodeData }
  | { id: string; type: 'agent'; position: FlowXY; data: FlowAgentNodeData }

export interface FlowEdge {
  id: string
  source: string
  target: string
}

export interface FlowDocument {
  id: string
  name: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  createdAt: string
  updatedAt: string
}

const flowInputNodeDataSchema = z.strictObject({
  inputText: z.string().max(100_000),
})

const flowToolRefSchema = z.strictObject({
  name: z.string().min(1).max(240),
  version: z.string().min(1).max(240),
})

/** 旧文档没有 config 字段：optional 保持向后兼容，不迁移存量数据。 */
const flowAgentInlineConfigSchema = z.strictObject({
  model: z.strictObject({ providerId: z.string().min(1), modelId: z.string().min(1) }).nullable(),
  systemPrompt: z.string().max(100_000),
  thinkingLevel: agentThinkingLevelSchema,
  maxTurns: z.number().int().min(1).max(32),
  toolRefs: z.array(flowToolRefSchema).max(64),
  skillIds: z.array(z.string().min(1)).max(64),
})

/** 节点名称长度上限：与节点卡片的紧凑展示匹配，独立于文档名的 120 上限。 */
export const FLOW_AGENT_NAME_MAX_LENGTH = 60

const flowAgentNodeDataSchema = z.strictObject({
  name: z.string().trim().max(FLOW_AGENT_NAME_MAX_LENGTH),
  agentId: z.string(),
  promptTemplate: z.string().max(100_000),
  config: flowAgentInlineConfigSchema.optional(),
})

export const flowNodeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: z.string().min(1),
    type: z.literal('input'),
    position: flowXYSchema,
    data: flowInputNodeDataSchema,
  }),
  z.strictObject({
    id: z.string().min(1),
    type: z.literal('agent'),
    position: flowXYSchema,
    data: flowAgentNodeDataSchema,
  }),
])

export const flowEdgeSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
})

/** 文档名与 Session 标题同宽：trim 后 1-120 字符。 */
export const FLOW_NAME_MAX_LENGTH = 120

export const flowDocumentSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(FLOW_NAME_MAX_LENGTH),
  nodes: z.array(flowNodeSchema).max(100),
  edges: z.array(flowEdgeSchema).max(200),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const flowDocumentListSchema = z.array(flowDocumentSchema)

export const FLOW_STORAGE_KEY = 'web-agent-flow/v1'

export interface FlowDocumentRepository {
  /** 读全部文档；存储为空或数据损坏时返回空列表（损坏数据直接丢弃）。 */
  load: () => FlowDocument[]
  save: (documents: FlowDocument[]) => void
}

/** localStorage 仓库；读写都过 schema 校验，损坏数据丢弃重建空列表。 */
export function createFlowDocumentRepository(storage: Storage): FlowDocumentRepository {
  return {
    load() {
      const raw = storage.getItem(FLOW_STORAGE_KEY)
      if (raw === null) return []
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return []
      }
      const result = flowDocumentListSchema.safeParse(parsed)
      return result.success ? result.data : []
    },
    save(documents) {
      storage.setItem(FLOW_STORAGE_KEY, JSON.stringify(documents))
    },
  }
}

function randomId(): string {
  return crypto.randomUUID()
}

/** 新建文档：自带一个输入节点和一个已连线的 Agent 节点，开箱即可运行。 */
export function createFlowDocument(now: Date = new Date()): FlowDocument {
  const timestamp = now.toISOString()
  const inputNodeId = randomId()
  const agentNodeId = randomId()
  return {
    id: randomId(),
    name: '未命名流程',
    nodes: [
      { id: inputNodeId, type: 'input', position: { x: 80, y: 200 }, data: { inputText: '' } },
      {
        id: agentNodeId,
        type: 'agent',
        position: { x: 440, y: 200 },
        data: { name: '', agentId: '', promptTemplate: '' },
      },
    ],
    edges: [{ id: randomId(), source: inputNodeId, target: agentNodeId }],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** 复制文档：所有 id 重新生成，名字追加「副本」并截断到上限内。 */
export function duplicateFlowDocument(source: FlowDocument, now: Date = new Date()): FlowDocument {
  const timestamp = now.toISOString()
  return {
    ...rebuildIds(source),
    name: `${source.name.slice(0, FLOW_NAME_MAX_LENGTH - 3)} 副本`,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/** 导出为 JSON 文本（UI 层负责 Blob 下载）。 */
export function serializeFlowDocument(document: FlowDocument): string {
  return JSON.stringify(document, null, 2)
}

/** 解析导入的 JSON 文本：schema 校验 + 全部 id 重新生成（防与现有文档冲突）。 */
export function parseFlowImport(text: string, now: Date = new Date()): FlowDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON。')
  }
  const result = flowDocumentSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error('文件内容不符合流程文档格式。')
  }
  const timestamp = now.toISOString()
  return { ...rebuildIds(result.data), createdAt: timestamp, updatedAt: timestamp }
}

/** 从文档中删除节点，并自动清理与其相连的所有边 */
export function removeNodeFromDocument(document: FlowDocument, nodeId: string): FlowDocument {
  return {
    ...document,
    nodes: document.nodes.filter((node) => node.id !== nodeId),
    edges: document.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  }
}

/** 重建文档的全部 id（文档、节点、边），连线关系按 id 映射还原；时间戳由调用方重置。 */
function rebuildIds(document: FlowDocument): Omit<FlowDocument, 'createdAt' | 'updatedAt'> {
  const idMap = new Map<string, string>()
  const nodes = document.nodes.map((node) => {
    const id = randomId()
    idMap.set(node.id, id)
    return { ...node, id }
  })
  const edges = document.edges.map((edge) => ({
    id: randomId(),
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
  }))
  return { id: randomId(), name: document.name, nodes, edges }
}
