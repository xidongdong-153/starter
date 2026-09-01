import type { FlowDocument, FlowEdge, FlowNode } from './flow-document'

/**
 * 运行前校验：图必须是从输入节点出发的单链，模板只能引用更早步骤的产出。
 * 纯函数，返回可读的中文错误列表，画布编辑期间不校验，只在点运行时调用。
 */

export interface FlowAgentStep {
  /** 节点在文档 nodes 数组里的下标，画布定位用。 */
  nodeIndex: number
  node: Extract<FlowNode, { type: 'agent' }>
}

export interface FlowChain {
  inputNodeId: string
  /** 按执行顺序排列的 agent 节点，链上从 0 计，与模板 steps.N 对齐。 */
  steps: FlowAgentStep[]
}

export type FlowValidationResult = { ok: true; chain: FlowChain } | { ok: false; errors: string[] }

/** 校验文档拓扑是否为「一个输入节点出发的单链」。 */
export function validateFlowGraph(document: FlowDocument): FlowValidationResult {
  const inputNodes = document.nodes.filter(
    (node): node is Extract<FlowNode, { type: 'input' }> => node.type === 'input',
  )
  const agentNodes = document.nodes.filter(
    (node): node is Extract<FlowNode, { type: 'agent' }> => node.type === 'agent',
  )
  const errors: string[] = []

  if (inputNodes.length === 0) errors.push('缺少输入节点，请添加一个输入节点。')
  if (inputNodes.length > 1) errors.push(`只能有一个输入节点，当前有 ${inputNodes.length} 个。`)
  if (agentNodes.length === 0) errors.push('至少需要一个 Agent 节点。')
  if (errors.length > 0) return { ok: false, errors }

  const inputNode = inputNodes[0]
  if (!inputNode) return { ok: false, errors }

  const nodeIds = new Set(document.nodes.map((node) => node.id))
  // 有名称的节点用「节点“XXX”」定位，无名称维持链上序号表述
  const agentLabel = new Map(
    agentNodes.map((node, index) => [
      node.id,
      node.data.name.trim().length > 0 ? `节点“${node.data.name}”` : `第 ${index + 1} 个 Agent 节点`,
    ]),
  )

  const outEdges = new Map<string, FlowEdge[]>()
  const inEdges = new Map<string, FlowEdge[]>()
  for (const edge of document.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push('存在指向不存在节点的连线，请检查画布。')
      continue
    }
    if (edge.source === edge.target) {
      errors.push('节点不能连线到自己。')
      continue
    }
    outEdges.set(edge.source, [...(outEdges.get(edge.source) ?? []), edge])
    inEdges.set(edge.target, [...(inEdges.get(edge.target) ?? []), edge])
  }

  for (const [nodeId, edges] of outEdges) {
    if (edges.length > 1) {
      errors.push(`${labelOf(nodeId, inputNode.id, agentLabel)}有多条下游连线，流程必须是单链。`)
    }
  }
  for (const [nodeId, edges] of inEdges) {
    if (edges.length > 1) {
      errors.push(`${labelOf(nodeId, inputNode.id, agentLabel)}有多条上游连线，流程必须是单链。`)
    }
  }

  // 从 input 沿唯一出边走链，遇到访问过的节点即有环。
  const chainStepIds: string[] = []
  const visited = new Set<string>([inputNode.id])
  let current = inputNode.id
  while (current !== undefined) {
    const next: FlowEdge | undefined = outEdges.get(current)?.[0]
    if (next === undefined) break
    if (visited.has(next.target)) {
      errors.push('流程中存在环，请断开形成环的连线。')
      break
    }
    visited.add(next.target)
    chainStepIds.push(next.target)
    current = next.target
  }

  for (const agent of agentNodes) {
    if (!chainStepIds.includes(agent.id)) {
      errors.push(`${agentLabel.get(agent.id)}没有连进流程，请把它连进链里或删除。`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const steps = chainStepIds
    .map((nodeId) => {
      const nodeIndex = document.nodes.findIndex((node) => node.id === nodeId)
      const node = document.nodes[nodeIndex]
      return node !== undefined && node.type === 'agent' ? { node, nodeIndex } : null
    })
    .filter((step): step is FlowAgentStep => step !== null)

  if (steps.length !== chainStepIds.length || steps.length === 0) {
    return { ok: false, errors: ['流程链的末端必须是 Agent 节点。'] }
  }

  return { ok: true, chain: { inputNodeId: inputNode.id, steps } }
}

function labelOf(nodeId: string, inputNodeId: string, agentLabel: Map<string, string>): string {
  if (nodeId === inputNodeId) return '输入节点'
  return agentLabel.get(nodeId) ?? '节点'
}

/** 校验 N 个步骤的模板：步骤 i 只能引用 steps.N.output 且 N < i；{{input}} 任意步骤可用。 */
export function validateStepTemplates(templates: string[]): string[] {
  const errors: string[] = []
  templates.forEach((template, index) => {
    for (const match of template.matchAll(/\{\{steps\.(\d+)\.output\}\}/g)) {
      const referenced = Number(match[1])
      if (referenced >= index) {
        errors.push(`第 ${index + 1} 个步骤的模板引用了 steps.${referenced}.output，只允许引用更早步骤的产出。`)
      }
    }
  })
  return errors
}
