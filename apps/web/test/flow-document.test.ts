import { expect, it } from 'vitest'
import {
  createFlowDocument,
  createFlowDocumentRepository,
  duplicateFlowDocument,
  FLOW_STORAGE_KEY,
  parseFlowImport,
  removeNodeFromDocument,
  serializeFlowDocument,
  type FlowDocument,
} from '@web/lib/flow/flow-document'

/** node 环境没有 localStorage，用内存实现注入。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

function makeDocument(overrides: Partial<FlowDocument> = {}): FlowDocument {
  return {
    ...createFlowDocument(),
    name: '测试流程',
    ...overrides,
  }
}

it('createFlowDocument 自带一个输入节点和一个已连线的 Agent 节点', () => {
  const document = createFlowDocument()
  expect(document.name).toBe('未命名流程')
  expect(document.nodes).toHaveLength(2)
  expect(document.nodes.filter((node) => node.type === 'input')).toHaveLength(1)
  expect(document.nodes.filter((node) => node.type === 'agent')).toHaveLength(1)
  expect(document.edges).toHaveLength(1)
  const edge = document.edges[0]
  const input = document.nodes.find((node) => node.type === 'input')
  expect(edge?.source).toBe(input?.id)
  expect(document.createdAt).toBe(document.updatedAt)
})

it('createFlowDocument 自带的 Agent 节点 name 为空串', () => {
  const document = createFlowDocument()
  const agentNode = document.nodes.find((node) => node.type === 'agent')
  if (agentNode?.type !== 'agent') throw new Error('fixture 缺少 agent 节点')
  expect(agentNode.data.name).toBe('')
})

it('repository load 丢弃 name 缺失的旧文档', () => {
  const storage = memoryStorage()
  const document = makeDocument()
  // 旧格式：agent 节点没有 name 字段，schema 校验失败后整份列表丢弃
  const legacy = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.type === 'agent'
        ? {
            id: node.id,
            type: 'agent' as const,
            position: node.position,
            data: { agentId: node.data.agentId, promptTemplate: node.data.promptTemplate },
          }
        : node,
    ),
  }
  storage.setItem(FLOW_STORAGE_KEY, JSON.stringify([legacy]))
  expect(createFlowDocumentRepository(storage).load()).toEqual([])
})

/** 把文档里第一个 agent 节点改成指定名称，方便各用例复用。 */
function withAgentName(document: FlowDocument, name: string): FlowDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => (node.type === 'agent' ? { ...node, data: { ...node.data, name } } : node)),
  }
}

it('带名称的文档 load 和导入都保留 name', () => {
  const named = withAgentName(makeDocument(), '提炼要点')
  const storage = memoryStorage()
  const repository = createFlowDocumentRepository(storage)
  repository.save([named])
  expect(repository.load()).toEqual([named])
  const imported = parseFlowImport(serializeFlowDocument(named))
  const importedAgent = imported.nodes.find((node) => node.type === 'agent')
  if (importedAgent?.type !== 'agent') throw new Error('导入结果缺少 agent 节点')
  expect(importedAgent.data.name).toBe('提炼要点')
})

it('name 超过 60 字符的导入被拒绝，60 字符正好通过', () => {
  expect(() => parseFlowImport(serializeFlowDocument(withAgentName(makeDocument(), '长'.repeat(61))))).toThrow(
    '文件内容不符合流程文档格式。',
  )
  const imported = parseFlowImport(serializeFlowDocument(withAgentName(makeDocument(), '长'.repeat(60))))
  const importedAgent = imported.nodes.find((node) => node.type === 'agent')
  if (importedAgent?.type !== 'agent') throw new Error('导入结果缺少 agent 节点')
  expect(importedAgent.data.name).toBe('长'.repeat(60))
})

it('duplicateFlowDocument 复制保留节点名称', () => {
  const named = withAgentName(makeDocument({ name: '主线流程' }), '提炼要点')
  const copy = duplicateFlowDocument(named)
  const agentNode = copy.nodes.find((node) => node.type === 'agent')
  if (agentNode?.type !== 'agent') throw new Error('副本缺少 agent 节点')
  expect(agentNode.data.name).toBe('提炼要点')
})

it('removeNodeFromDocument 删除指定节点并级联清理所有关联的边', () => {
  const document = createFlowDocument()
  const agentNode = document.nodes.find((node) => node.type === 'agent')!
  const updated = removeNodeFromDocument(document, agentNode.id)
  expect(updated.nodes).toHaveLength(1)
  expect(updated.nodes.some((node) => node.id === agentNode.id)).toBe(false)
  expect(updated.edges).toHaveLength(0)
})

it('repository load 空存储返回空列表', () => {
  const repository = createFlowDocumentRepository(memoryStorage())
  expect(repository.load()).toEqual([])
})

it('repository save 后 load 还原文档（roundtrip）', () => {
  const storage = memoryStorage()
  const repository = createFlowDocumentRepository(storage)
  const document = makeDocument()
  repository.save([document])
  expect(storage.getItem(FLOW_STORAGE_KEY)).toBeTruthy()
  expect(repository.load()).toEqual([document])
})

it('repository load 损坏 JSON 返回空列表', () => {
  const storage = memoryStorage()
  storage.setItem(FLOW_STORAGE_KEY, '{broken json')
  expect(createFlowDocumentRepository(storage).load()).toEqual([])
})

it('repository load 不符合 schema 的数据返回空列表', () => {
  const storage = memoryStorage()
  storage.setItem(FLOW_STORAGE_KEY, JSON.stringify([{ id: 'x', name: '' }]))
  expect(createFlowDocumentRepository(storage).load()).toEqual([])
})

it('repository load 缺少必填字段的文档丢弃整份列表', () => {
  const storage = memoryStorage()
  const document = makeDocument()
  const broken = { ...document, nodes: [{ id: 'n1', type: 'agent', position: { x: 0, y: 0 } }] }
  storage.setItem(FLOW_STORAGE_KEY, JSON.stringify([broken]))
  expect(createFlowDocumentRepository(storage).load()).toEqual([])
})

it('serializeFlowDocument 与 parseFlowImport roundtrip 还原图结构', () => {
  const document = makeDocument()
  const imported = parseFlowImport(serializeFlowDocument(document))
  expect(imported.name).toBe(document.name)
  // id 全部重建，比较节点内容和连线指向关系
  expect(imported.nodes.map((node) => [node.type, node.position, node.data])).toEqual(
    document.nodes.map((node) => [node.type, node.position, node.data]),
  )
  // id 全部重建，但节点顺序不变；连线按两端节点在数组中的下标对应比较
  const indexOf = (nodes: FlowDocument['nodes'], id: string) => nodes.findIndex((node) => node.id === id)
  expect(
    document.edges.map((edge) => [indexOf(document.nodes, edge.source), indexOf(document.nodes, edge.target)]),
  ).toEqual(imported.edges.map((edge) => [indexOf(imported.nodes, edge.source), indexOf(imported.nodes, edge.target)]))
})

it('parseFlowImport 重新生成全部 id，避免与现有文档冲突', () => {
  const document = makeDocument()
  const imported = parseFlowImport(serializeFlowDocument(document))
  expect(imported.id).not.toBe(document.id)
  expect(imported.nodes.map((node) => node.id).some((id) => document.nodes.some((node) => node.id === id))).toBe(false)
  expect(imported.edges.map((edge) => edge.id).some((id) => document.edges.some((edge) => edge.id === id))).toBe(false)
  // 连线关系仍然指向对应节点
  const edge = imported.edges[0]
  expect(imported.nodes.some((node) => node.id === edge?.source)).toBe(true)
  expect(imported.nodes.some((node) => node.id === edge?.target)).toBe(true)
})

it('parseFlowImport 非 JSON 文本报错', () => {
  expect(() => parseFlowImport('not json')).toThrow('文件不是有效的 JSON。')
})

it('parseFlowImport 缺字段的 JSON 报错不落库', () => {
  expect(() => parseFlowImport(JSON.stringify({ hello: 'world' }))).toThrow('文件内容不符合流程文档格式。')
})

it('duplicateFlowDocument 复制内容并重建 id', () => {
  const document = makeDocument({ name: '主线流程' })
  const copy = duplicateFlowDocument(document)
  expect(copy.name).toBe('主线流程 副本')
  expect(copy.id).not.toBe(document.id)
  expect(copy.nodes).toHaveLength(document.nodes.length)
  expect(copy.edges).toHaveLength(document.edges.length)
  expect(copy.nodes[0]?.id).not.toBe(document.nodes[0]?.id)
  expect(copy.createdAt).toBe(copy.updatedAt)
})

it('duplicateFlowDocument 超长名字截断到上限', () => {
  const document = makeDocument({ name: '长'.repeat(120) })
  const copy = duplicateFlowDocument(document)
  expect(copy.name.length).toBeLessThanOrEqual(120)
  expect(copy.name.endsWith('副本')).toBe(true)
})
