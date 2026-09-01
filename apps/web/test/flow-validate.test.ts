import { expect, it } from 'vitest'
import type { FlowDocument, FlowNode } from '@web/lib/flow/flow-document'
import { createFlowDocument } from '@web/lib/flow/flow-document'
import { validateFlowGraph, validateStepTemplates } from '@web/lib/flow/flow-validate'

let sequence = 0

function makeNode(
  type: 'agent' | 'input',
  overrides: { data?: Partial<Extract<FlowNode, { type: 'agent' }>['data']> } = {},
): FlowNode {
  sequence += 1
  if (type === 'input') {
    return { id: `node-${sequence}`, type: 'input', position: { x: 0, y: 0 }, data: { inputText: '' } }
  }
  return {
    id: `node-${sequence}`,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { name: '', agentId: `agent-${sequence}`, promptTemplate: '{{input}}', ...overrides.data },
  }
}

function makeDocument(nodes: FlowNode[], edges: [string, string][]): FlowDocument {
  const base = createFlowDocument()
  return {
    ...base,
    nodes,
    edges: edges.map(([source, target]) => ({ id: `edge-${source}-${target}`, source, target })),
  }
}

it('合法单链通过校验，steps 按执行顺序排列', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const b = makeNode('agent')
  const result = validateFlowGraph(
    makeDocument(
      [input, b, a],
      [
        [input.id, a.id],
        [a.id, b.id],
      ],
    ),
  )
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.chain.inputNodeId).toBe(input.id)
  expect(result.chain.steps.map((step) => step.node.id)).toEqual([a.id, b.id])
})

it('多个输入节点报错', () => {
  const inputA = makeNode('input')
  const inputB = makeNode('input')
  const a = makeNode('agent')
  const result = validateFlowGraph(makeDocument([inputA, inputB, a], [[inputA.id, a.id]]))
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('只能有一个输入节点'))).toBe(true)
})

it('没有输入节点报错', () => {
  const a = makeNode('agent')
  const b = makeNode('agent')
  const result = validateFlowGraph(makeDocument([a, b], [[a.id, b.id]]))
  expect(result.ok).toBe(false)
})

it('没有 Agent 节点报错', () => {
  const input = makeNode('input')
  const result = validateFlowGraph(makeDocument([input], []))
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('至少需要一个 Agent 节点'))).toBe(true)
})

it('分叉（一个节点两条出边）报错', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const b = makeNode('agent')
  const result = validateFlowGraph(
    makeDocument(
      [input, a, b],
      [
        [input.id, a.id],
        [input.id, b.id],
      ],
    ),
  )
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('多条下游连线'))).toBe(true)
  expect(result.errors.some((message) => message.includes('没有连进流程'))).toBe(true)
})

it('汇合（一个节点两条入边）报错', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const b = makeNode('agent')
  const result = validateFlowGraph(
    makeDocument(
      [input, a, b],
      [
        [input.id, a.id],
        [input.id, b.id],
        [a.id, b.id],
      ],
    ),
  )
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('多条上游连线'))).toBe(true)
})

it('环报错', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const b = makeNode('agent')
  const result = validateFlowGraph(
    makeDocument(
      [input, a, b],
      [
        [input.id, a.id],
        [a.id, b.id],
        [b.id, a.id],
      ],
    ),
  )
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('环'))).toBe(true)
})

it('自环报错', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const result = validateFlowGraph(
    makeDocument(
      [input, a],
      [
        [input.id, a.id],
        [a.id, a.id],
      ],
    ),
  )
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('自己'))).toBe(true)
})

it('不可达的孤立 Agent 节点报错', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const orphan = makeNode('agent')
  const result = validateFlowGraph(makeDocument([input, a, orphan], [[input.id, a.id]]))
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('没有连进流程'))).toBe(true)
})

it('悬空边（指向不存在的节点）报错', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const result = validateFlowGraph(
    makeDocument(
      [input, a],
      [
        [input.id, a.id],
        [a.id, 'ghost'],
      ],
    ),
  )
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('不存在节点'))).toBe(true)
})

it('单条链上 Agent 断开（中间缺失）报错', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const result = validateFlowGraph(makeDocument([input, a], []))
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('没有连进流程'))).toBe(true)
})

it('有名称的节点报错消息用名称定位', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const orphan = makeNode('agent', { data: { name: '提炼要点' } })
  const result = validateFlowGraph(makeDocument([input, a, orphan], [[input.id, a.id]]))
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('节点“提炼要点”没有连进流程'))).toBe(true)
})

it('无名称的节点报错消息维持链上序号表述', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const orphan = makeNode('agent')
  const result = validateFlowGraph(makeDocument([input, a, orphan], [[input.id, a.id]]))
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('第 2 个 Agent 节点没有连进流程'))).toBe(true)
})

it('多上游连线报错带节点名称', () => {
  const input = makeNode('input')
  const a = makeNode('agent')
  const b = makeNode('agent', { data: { name: '英文简报' } })
  const result = validateFlowGraph(
    makeDocument(
      [input, a, b],
      [
        [input.id, b.id],
        [a.id, b.id],
        [input.id, a.id],
      ],
    ),
  )
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.errors.some((message) => message.includes('节点“英文简报”有多条上游连线'))).toBe(true)
})

it('validateStepTemplates 引用更早步骤通过', () => {
  expect(validateStepTemplates(['{{input}}', '{{steps.0.output}}'])).toEqual([])
})

it('validateStepTemplates 引用自身或更晚步骤报错', () => {
  const errors = validateStepTemplates(['{{steps.0.output}}', '{{steps.1.output}}'])
  expect(errors).toHaveLength(2)
  expect(errors[0]).toContain('第 1 个步骤')
  expect(errors[0]).toContain('steps.0.output')
  expect(errors[1]).toContain('第 2 个步骤')
})

it('validateStepTemplates 第 2 步引用第 1 步通过，引用第 2 步报错', () => {
  const errors = validateStepTemplates(['{{input}}', 'a: {{steps.0.output}} b: {{steps.1.output}}'])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('第 2 个步骤')
})

it('validateStepTemplates 普通文本和未知变量不报错', () => {
  expect(validateStepTemplates(['直接写文字', '{{unknown}}'])).toEqual([])
})
