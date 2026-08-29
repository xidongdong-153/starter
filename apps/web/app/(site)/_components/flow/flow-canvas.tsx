'use client'

import '@xyflow/react/dist/style.css'

import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react'
import { Download, LogIn, Play, Plus, Square, Upload } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { Button } from '@web/components/ui/button'
import { Input } from '@web/components/ui/input'
import type { FlowDocument, FlowEdge, FlowNode } from '@web/lib/flow/flow-document'
import type { FlowStepRunState } from '@web/lib/flow/flow-run'
import { cn } from '@web/lib/utils'

import { FlowNodeAgent } from './flow-node-agent'
import { FlowNodeInput } from './flow-node-input'

/** 文档级的节点变更应用：只处理位置和删除，其他视觉态不落库。 */
function applyDocumentNodeChanges(changes: NodeChange[], nodes: FlowNode[]): FlowNode[] {
  let next = nodes
  for (const change of changes) {
    if (change.type === 'position' && change.position !== undefined) {
      const position = change.position
      next = next.map((node) => (node.id === change.id ? { ...node, position } : node))
    } else if (change.type === 'remove') {
      next = next.filter((node) => node.id !== change.id)
    }
  }
  return next
}

/** 文档级的边变更应用：只有删除会落到文档。 */
function applyDocumentEdgeChanges(changes: EdgeChange[], edges: FlowEdge[]): FlowEdge[] {
  let next = edges
  for (const change of changes) {
    if (change.type === 'remove') {
      next = next.filter((edge) => edge.id !== change.id)
    }
  }
  return next
}

/**
 * 把 select 变更应用到选中的节点/边 id 集合。
 * React Flow 受控模式下元素的 selected 完全来自 props，删除键（Backspace）
 * 依赖 selected 过滤元素；select 不写回就无法删除节点和边。
 */
function applySelectionChanges(
  changes: Array<NodeChange | EdgeChange>,
  selectedIds: ReadonlySet<string>,
): Set<string> | null {
  let next: Set<string> | null = null
  for (const change of changes) {
    if (change.type === 'select') {
      next ??= new Set(selectedIds)
      if (change.selected) next.add(change.id)
      else next.delete(change.id)
    } else if (change.type === 'remove') {
      next ??= new Set(selectedIds)
      next.delete(change.id)
    }
  }
  return next
}

const NODE_TYPES: NodeTypes = {
  agent: FlowNodeAgent,
  input: FlowNodeInput,
}

const DEFAULT_EDGE_OPTIONS = {
  type: 'straight',
  markerEnd: { type: MarkerType.ArrowClosed },
} as const

export interface FlowCanvasProps {
  document: FlowDocument
  /** 链上序号，nodeId → 从 0 计的步骤序号。 */
  chainIndex: Map<string, number>
  /** agentId → 名称。 */
  agentNames: Map<string, string>
  /** 运行态，nodeId → 步骤状态。 */
  stepStates: Record<string, FlowStepRunState>
  selectedNodeId: string | null
  running: boolean
  stopping: boolean
  canStop: boolean
  onDocumentChange: (changes: { nodes: FlowNode[]; edges: FlowEdge[] }) => void
  onInputTextChange: (nodeId: string, text: string) => void
  onSelectNode: (nodeId: string | null) => void
  onRun: () => void
  onStop: () => void
  onImport: (file: File) => void
  onExport: () => void
  onRename: (name: string) => void
  className?: string
}

/**
 * React Flow 画布：受控模式，文档节点是唯一事实来源。
 * selection / dimensions 等视觉态不写回文档；结构性变化（位置、连线、删除）全量同步。
 * 选中高亮用 selectedNodeId 注入，不依赖 React Flow 内部 selection。
 */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function FlowCanvasInner({
  document,
  chainIndex,
  agentNames,
  stepStates,
  selectedNodeId,
  running,
  stopping,
  canStop,
  onDocumentChange,
  onInputTextChange,
  onSelectNode,
  onRun,
  onStop,
  onImport,
  onExport,
  onRename,
  className,
}: FlowCanvasProps) {
  const { screenToFlowPosition } = useReactFlow()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  /** React Flow 的元素选中态（删除键依赖它）；视觉态不落库，只存在组件 state。 */
  const [selectedElementIds, setSelectedElementIds] = useState<ReadonlySet<string>>(() => new Set())

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // dimensions 是节点测量的通知，React Flow 内部已维护；select 落在组件 state
      const documentChanges = changes.filter((change) => change.type !== 'select' && change.type !== 'dimensions')
      if (documentChanges.length > 0) {
        onDocumentChange({ nodes: applyDocumentNodeChanges(documentChanges, document.nodes), edges: document.edges })
      }
      const selection = applySelectionChanges(changes, selectedElementIds)
      if (selection !== null) setSelectedElementIds(selection)
    },
    [document.edges, document.nodes, onDocumentChange, selectedElementIds],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const documentChanges = changes.filter((change) => change.type !== 'select')
      if (documentChanges.length > 0) {
        onDocumentChange({ nodes: document.nodes, edges: applyDocumentEdgeChanges(documentChanges, document.edges) })
      }
      const selection = applySelectionChanges(changes, selectedElementIds)
      if (selection !== null) setSelectedElementIds(selection)
    },
    [document.nodes, onDocumentChange, selectedElementIds],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === null || connection.target === null) return
      const edge: FlowEdge = { id: crypto.randomUUID(), source: connection.source, target: connection.target }
      onDocumentChange({ nodes: document.nodes, edges: [...document.edges, edge] })
    },
    [document.edges, document.nodes, onDocumentChange],
  )

  const displayNodes: Node[] = useMemo(
    () =>
      document.nodes.map((node) => {
        if (node.type === 'input') {
          return {
            id: node.id,
            type: 'input' as const,
            position: node.position,
            selected: selectedElementIds.has(node.id),
            data: {
              inputText: node.data.inputText,
              onInputTextChange: (text: string) => onInputTextChange(node.id, text),
            },
          }
        }
        return {
          id: node.id,
          type: 'agent' as const,
          position: node.position,
          selected: selectedElementIds.has(node.id),
          data: {
            agentId: node.data.agentId,
            promptTemplate: node.data.promptTemplate,
            stepIndex: chainIndex.get(node.id) ?? null,
            agentName: node.data.agentId.length > 0 ? (agentNames.get(node.data.agentId) ?? null) : null,
            runState: stepStates[node.id] ?? null,
            isSelected: node.id === selectedNodeId,
          },
        }
      }),
    [agentNames, chainIndex, document.nodes, onInputTextChange, selectedElementIds, selectedNodeId, stepStates],
  )

  const displayEdges: Edge[] = useMemo(
    () => document.edges.map((edge) => ({ ...edge, selected: selectedElementIds.has(edge.id) })),
    [document.edges, selectedElementIds],
  )

  const hasInputNode = document.nodes.some((node) => node.type === 'input')

  function handleAddNode(type: 'agent' | 'input') {
    if (type === 'input' && hasInputNode) return
    const position = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const node: FlowNode =
      type === 'input'
        ? { id: crypto.randomUUID(), type: 'input', position, data: { inputText: '' } }
        : {
            id: crypto.randomUUID(),
            type: 'agent',
            position: { x: position.x + 40, y: position.y + 40 },
            data: { agentId: '', promptTemplate: '' },
          }
    onDocumentChange({ nodes: [...document.nodes, node], edges: document.edges })
    onSelectNode(node.id)
  }

  function handleImportSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 允许连续导入同一个文件：先清空选择
    event.target.value = ''
    if (file !== undefined) onImport(file)
  }

  function commitName() {
    const next = nameDraft?.trim()
    setNameDraft(null)
    if (next !== undefined && next.length > 0 && next !== document.name) onRename(next)
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface/90 px-3 py-2 backdrop-blur-md">
        {nameDraft === null ? (
          <button
            className="min-h-9 max-w-56 truncate px-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => setNameDraft(document.name)}
            title="编辑流程名称"
            type="button"
          >
            {document.name}
          </button>
        ) : (
          <Input
            autoFocus
            className="h-9 w-56 text-xs"
            onBlur={commitName}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName()
              if (event.key === 'Escape') setNameDraft(null)
            }}
            value={nameDraft}
          />
        )}

        <div className="mx-1 h-6 w-px bg-border" />

        <Button
          disabled={hasInputNode}
          onClick={() => handleAddNode('input')}
          size="sm"
          title={hasInputNode ? '已有一个输入节点' : '添加输入节点'}
          type="button"
          variant="outline"
        >
          <LogIn aria-hidden="true" size={14} />
          输入节点
        </Button>
        <Button onClick={() => handleAddNode('agent')} size="sm" type="button" variant="outline">
          <Plus aria-hidden="true" size={14} />
          Agent 节点
        </Button>

        <div className="mx-1 h-6 w-px bg-border" />

        {running ? (
          <Button disabled={!canStop} onClick={onStop} size="sm" type="button" variant="destructive">
            <Square aria-hidden="true" size={14} />
            {stopping ? '正在停止' : '停止'}
          </Button>
        ) : (
          <Button onClick={onRun} size="sm" type="button">
            <Play aria-hidden="true" size={14} />
            运行
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            disabled={running}
            onClick={() => importInputRef.current?.click()}
            size="sm"
            type="button"
            variant="outline"
          >
            <Upload aria-hidden="true" size={14} />
            导入
          </Button>
          <Button onClick={onExport} size="sm" type="button" variant="outline">
            <Download aria-hidden="true" size={14} />
            导出
          </Button>
          <input
            accept="application/json,.json"
            className="sr-only"
            onChange={handleImportSelect}
            ref={importInputRef}
            type="file"
          />
        </div>
      </div>

      {/* 画布 */}
      <div className="min-h-0 flex-1">
        <ReactFlow
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          edges={displayEdges}
          fitView
          nodes={displayNodes}
          nodeTypes={NODE_TYPES}
          onConnect={handleConnect}
          onEdgesChange={handleEdgesChange}
          onNodeClick={(_, node) => onSelectNode(node.id)}
          onNodesChange={handleNodesChange}
          onPaneClick={() => onSelectNode(null)}
        >
          <Background color="var(--color-border)" gap={24} size={1.5} variant={BackgroundVariant.Dots} />
        </ReactFlow>
      </div>
    </div>
  )
}
