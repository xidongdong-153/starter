'use client'

import '@xyflow/react/dist/style.css'

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react'
import {
  Download,
  Maximize2,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  Square,
  Upload,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { AnimatedPulseEdge } from '@web/components/react-bits/animated-edge'
import { ClickSpark } from '@web/components/react-bits/click-spark'
import { Magnet } from '@web/components/react-bits/magnet'
import { Button } from '@web/components/ui/button'
import { Input } from '@web/components/ui/input'
import { removeNodeFromDocument, type FlowDocument, type FlowEdge, type FlowNode } from '@web/lib/flow/flow-document'
import type { FlowStepRunState } from '@web/lib/flow/flow-run'
import { cn } from '@web/lib/utils'

import { FlowNodeAgent } from './flow-node-agent'
import { FlowNodeInput } from './flow-node-input'

/** 文档级的节点变更应用：处理位置变更与删除（级联删除相连边）。 */
function applyDocumentNodeAndEdgeChanges(
  changes: NodeChange[],
  nodes: FlowNode[],
  edges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let nextNodes = nodes
  let nextEdges = edges
  const removedIds = new Set<string>()

  for (const change of changes) {
    if (change.type === 'position' && change.position !== undefined) {
      const position = change.position
      nextNodes = nextNodes.map((node) => (node.id === change.id ? { ...node, position } : node))
    } else if (change.type === 'remove') {
      removedIds.add(change.id)
      nextNodes = nextNodes.filter((node) => node.id !== change.id)
    }
  }

  if (removedIds.size > 0) {
    nextEdges = nextEdges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target))
  }

  return { nodes: nextNodes, edges: nextEdges }
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

const EDGE_TYPES: EdgeTypes = {
  pulse: AnimatedPulseEdge,
}

const DEFAULT_EDGE_OPTIONS = {
  type: 'smoothstep',
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
  isLeftCollapsed?: boolean
  isRightCollapsed?: boolean
  onToggleLeftCollapse?: () => void
  onToggleRightCollapse?: () => void
  onDocumentChange: (changes: { nodes: FlowNode[]; edges: FlowEdge[] }) => void
  onInputTextChange: (nodeId: string, text: string) => void
  onSelectNode: (nodeId: string | null) => void
  onDeleteNode?: (nodeId: string) => void
  onRun: () => void
  onStop: () => void
  onImport: (file: File) => void
  onExport: () => void
  onRename: (name: string) => void
  className?: string
}

/**
 * React Flow 画布：受控模式，文档节点是唯一事实来源。
 * 支持 MiniMap、Controls、一键快速追加节点、动态连线流动光效与宽屏折叠。
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
  isLeftCollapsed = false,
  isRightCollapsed = false,
  onToggleLeftCollapse,
  onToggleRightCollapse,
  onDocumentChange,
  onInputTextChange,
  onSelectNode,
  onDeleteNode,
  onRun,
  onStop,
  onImport,
  onExport,
  onRename,
  className,
}: FlowCanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow()
  const importInputRef = useRef<HTMLInputElement>(null)
  const nodeMeasuredRef = useRef<Map<string, { width: number; height: number }>>(new Map())
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [selectedElementIds, setSelectedElementIds] = useState<ReadonlySet<string>>(() => new Set())

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (onDeleteNode) {
        onDeleteNode(nodeId)
      } else {
        onDocumentChange(removeNodeFromDocument(document, nodeId))
      }
      if (selectedNodeId === nodeId) {
        onSelectNode(null)
      }
    },
    [document, onDeleteNode, onDocumentChange, onSelectNode, selectedNodeId],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'dimensions' && change.dimensions) {
          nodeMeasuredRef.current.set(change.id, change.dimensions)
        } else if (change.type === 'remove') {
          nodeMeasuredRef.current.delete(change.id)
          if (selectedNodeId === change.id) {
            onSelectNode(null)
          }
        }
      }

      const documentChanges = changes.filter((change) => change.type !== 'select' && change.type !== 'dimensions')
      if (documentChanges.length > 0) {
        onDocumentChange(applyDocumentNodeAndEdgeChanges(documentChanges, document.nodes, document.edges))
      }
      const selection = applySelectionChanges(changes, selectedElementIds)
      if (selection !== null) setSelectedElementIds(selection)
    },
    [document.edges, document.nodes, onDocumentChange, onSelectNode, selectedElementIds, selectedNodeId],
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

  /** 快捷追加下一个 Agent 节点并自动连线 */
  const handleQuickAddNext = useCallback(
    (sourceNodeId: string) => {
      const sourceNode = document.nodes.find((n) => n.id === sourceNodeId)
      const basePos = sourceNode?.position ?? { x: 100, y: 180 }
      const newPos = { x: basePos.x + 360, y: basePos.y }
      const newNodeId = crypto.randomUUID()

      const newNode: FlowNode = {
        id: newNodeId,
        type: 'agent',
        position: newPos,
        data: { agentId: '', promptTemplate: '' },
      }
      const newEdge: FlowEdge = {
        id: crypto.randomUUID(),
        source: sourceNodeId,
        target: newNodeId,
      }

      onDocumentChange({
        nodes: [...document.nodes, newNode],
        edges: [...document.edges, newEdge],
      })
      onSelectNode(newNodeId)
    },
    [document.edges, document.nodes, onDocumentChange, onSelectNode],
  )

  const displayNodes: Node[] = useMemo(
    () =>
      document.nodes.map((node) => {
        const measured =
          nodeMeasuredRef.current.get(node.id) ??
          (node.type === 'input' ? { width: 320, height: 180 } : { width: 320, height: 160 })

        if (node.type === 'input') {
          return {
            id: node.id,
            type: 'input' as const,
            position: node.position,
            selected: selectedElementIds.has(node.id) || node.id === selectedNodeId,
            measured,
            data: {
              inputText: node.data.inputText,
              onInputTextChange: (text: string) => onInputTextChange(node.id, text),
              onQuickAddNext: handleQuickAddNext,
              onDelete: handleDeleteNode,
            },
          }
        }
        return {
          id: node.id,
          type: 'agent' as const,
          position: node.position,
          selected: selectedElementIds.has(node.id) || node.id === selectedNodeId,
          measured,
          data: {
            agentId: node.data.agentId,
            promptTemplate: node.data.promptTemplate,
            stepIndex: chainIndex.get(node.id) ?? null,
            isCustom: node.data.config !== undefined,
            agentName:
              node.data.config === undefined && node.data.agentId.length > 0
                ? (agentNames.get(node.data.agentId) ?? null)
                : null,
            runState: stepStates[node.id] ?? null,
            isSelected: node.id === selectedNodeId,
            onQuickAddNext: handleQuickAddNext,
            onDelete: handleDeleteNode,
          },
        }
      }),
    [
      agentNames,
      chainIndex,
      document.nodes,
      handleDeleteNode,
      handleQuickAddNext,
      onInputTextChange,
      selectedElementIds,
      selectedNodeId,
      stepStates,
    ],
  )

  /** 动态脉冲连线：当目标节点处于 running 时，连接线呈现发光能量粒子流动效果 */
  const displayEdges: Edge[] = useMemo(
    () =>
      document.edges.map((edge) => {
        const targetStep = stepStates[edge.target]
        const isTargetRunning = targetStep?.status === 'running'
        const isSelected = selectedElementIds.has(edge.id)

        return {
          ...edge,
          type: isTargetRunning ? 'pulse' : 'smoothstep',
          animated: isTargetRunning,
          selected: isSelected,
          data: {
            isAnimated: isTargetRunning,
            pulseColor: 'var(--color-primary, #eb6f92)',
          },
          style: isTargetRunning ? { stroke: 'var(--color-primary)', strokeWidth: 2 } : undefined,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isTargetRunning || isSelected ? 'var(--color-primary)' : 'var(--color-border)',
          },
        }
      }),
    [document.edges, selectedElementIds, stepStates],
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/90 px-3 py-2 backdrop-blur-md">
        <div className="flex items-center gap-2">
          {isLeftCollapsed && onToggleLeftCollapse ? (
            <Button
              aria-label="展开流程列表"
              className="size-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleLeftCollapse}
              size="icon"
              title="展开流程列表"
              type="button"
              variant="outline"
            >
              <PanelLeftOpen aria-hidden="true" size={15} />
            </Button>
          ) : null}

          {nameDraft === null ? (
            <button
              className="min-h-8 max-w-56 truncate px-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => setNameDraft(document.name)}
              title="编辑流程名称"
              type="button"
            >
              {document.name}
            </button>
          ) : (
            <Input
              autoFocus
              className="h-8 w-56 text-xs"
              onBlur={commitName}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitName()
                if (event.key === 'Escape') setNameDraft(null)
              }}
              value={nameDraft}
            />
          )}

          <div className="mx-0.5 h-5 w-px bg-border" />

          <ClickSpark sparkColor="rgba(235, 111, 146, 0.7)" sparkCount={6}>
            <Button
              disabled={hasInputNode}
              onClick={() => handleAddNode('input')}
              size="sm"
              title={hasInputNode ? '已有一个输入节点' : '添加输入节点'}
              type="button"
              variant="outline"
            >
              <Plus aria-hidden="true" size={13} />
              输入节点
            </Button>
          </ClickSpark>
          <ClickSpark sparkColor="rgba(235, 111, 146, 0.7)" sparkCount={6}>
            <Button onClick={() => handleAddNode('agent')} size="sm" type="button" variant="outline">
              <Plus aria-hidden="true" size={13} />
              Agent 节点
            </Button>
          </ClickSpark>

          <div className="mx-0.5 h-5 w-px bg-border" />

          {running ? (
            <Magnet disabled={!canStop} magnetStrength={0.2} padding={15}>
              <ClickSpark sparkColor="rgba(235, 111, 146, 0.9)" sparkCount={8}>
                <Button disabled={!canStop} onClick={onStop} size="sm" type="button" variant="destructive">
                  <Square aria-hidden="true" size={13} />
                  {stopping ? '正在停止…' : '停止'}
                </Button>
              </ClickSpark>
            </Magnet>
          ) : (
            <Magnet magnetStrength={0.25} padding={18}>
              <ClickSpark sparkColor="rgba(235, 111, 146, 0.9)" sparkCount={10}>
                <Button onClick={onRun} size="sm" type="button">
                  <Play aria-hidden="true" size={13} />
                  运行
                </Button>
              </ClickSpark>
            </Magnet>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            aria-label="自适应居中视角"
            onClick={() => fitView({ duration: 300, padding: 0.2 })}
            size="sm"
            title="自适应居中视角"
            type="button"
            variant="ghost"
          >
            <Maximize2 aria-hidden="true" size={14} />
            <span className="hidden sm:inline">居中</span>
          </Button>

          <Button
            disabled={running}
            onClick={() => importInputRef.current?.click()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Upload aria-hidden="true" size={14} />
            <span className="hidden sm:inline">导入</span>
          </Button>
          <Button onClick={onExport} size="sm" type="button" variant="ghost">
            <Download aria-hidden="true" size={14} />
            <span className="hidden sm:inline">导出</span>
          </Button>
          <input
            accept="application/json,.json"
            className="sr-only"
            onChange={handleImportSelect}
            ref={importInputRef}
            type="file"
          />

          {onToggleRightCollapse ? (
            <>
              <div className="mx-0.5 h-5 w-px bg-border" />
              <Button
                aria-label={isRightCollapsed ? '展开检查面板' : '收起检查面板'}
                className="size-8 p-0 text-muted-foreground hover:text-foreground"
                onClick={onToggleRightCollapse}
                size="icon"
                title={isRightCollapsed ? '展开检查面板' : '收起检查面板'}
                type="button"
                variant="outline"
              >
                {isRightCollapsed ? (
                  <PanelRightOpen aria-hidden="true" size={15} />
                ) : (
                  <PanelRightClose aria-hidden="true" size={15} />
                )}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* 画布区域 */}
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          edgeTypes={EDGE_TYPES}
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
          <Controls className="!border-border !bg-surface shadow-md" position="bottom-left" showInteractive={false} />
          <MiniMap
            className="!hidden !border-border !bg-surface/90 shadow-md md:!block"
            maskColor="color-mix(in srgb, var(--theme-base) 60%, transparent)"
            maskStrokeColor="var(--color-primary)"
            nodeColor="var(--color-primary)"
            position="bottom-right"
            zoomable
          />
        </ReactFlow>
      </div>
    </div>
  )
}
