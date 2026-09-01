'use client'

import type { AgentDefinitionSummary, AiSkillSummary, AiToolSummary, AiUserModel } from '@starter/contracts'
import { AlertCircle, LogIn, RefreshCw } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@web/components/ui/button'
import { listEnabledSkills, listAiTools, listUserModels } from '@web/lib/api/ai-resources.api'
import { getRuntimeAgents } from '@web/lib/api/flow.api'
import { authClient } from '@web/lib/auth-client'
import type { FlowAgentInlineConfig, FlowDocument, FlowEdge, FlowNode } from '@web/lib/flow/flow-document'
import {
  createFlowAgentInlineConfig,
  createFlowDocument,
  createFlowDocumentRepository,
  duplicateFlowDocument,
  parseFlowImport,
  serializeFlowDocument,
} from '@web/lib/flow/flow-document'
import { BUILTIN_FLOW_TEMPLATES } from '@web/lib/flow/flow-templates'
import type { FlowStepRunState } from '@web/lib/flow/flow-run'
import { validateFlowGraph, validateStepTemplates } from '@web/lib/flow/flow-validate'
import { useFlowRun } from '@web/hooks/use-flow-run'
import { cn } from '@web/lib/utils'

import { FlowInspector } from './flow-inspector'
import { FlowSidebar } from './flow-sidebar'

/** React Flow 不做 SSR：画布惰性加载，避开 hydration 问题。 */
const FlowCanvas = dynamic(() => import('./flow-canvas').then((mod) => mod.FlowCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">正在加载画布…</div>
  ),
})

/** localStorage 写入防抖间隔：拖动节点时位置变化是高频操作。 */
const PERSIST_DEBOUNCE_MS = 300

function touchDocument(document: FlowDocument): FlowDocument {
  return { ...document, updatedAt: new Date().toISOString() }
}

/**
 * Flow 工作台：登录门禁 + 左侧文档列表 + 中间画布 + 右侧节点配置面板。
 * 支持双向面板折叠以扩大宽屏操作区，支持预置工作流模板一键载入。
 */
export function FlowWorkspace({ className }: { className?: string }) {
  const { data: session, isPending } = authClient.useSession()
  const userId = session?.user.id ?? null

  const [documents, setDocuments] = useState<FlowDocument[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDefinitionSummary[]>([])
  const [agentsFailed, setAgentsFailed] = useState(false)
  const [agentsAttempt, setAgentsAttempt] = useState(0)
  const [models, setModels] = useState<AiUserModel[]>([])
  const [tools, setTools] = useState<AiToolSummary[]>([])
  const [skills, setSkills] = useState<AiSkillSummary[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [isRightCollapsed, setIsRightCollapsed] = useState(false)

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const documentsRef = useRef<FlowDocument[] | null>(null)
  documentsRef.current = documents

  const flowRun = useFlowRun()

  // 首次挂载读 localStorage；空列表时建一份带输入节点和 Agent 节点的初始文档
  useEffect(() => {
    const repository = createFlowDocumentRepository(window.localStorage)
    const loaded = repository.load()
    if (loaded.length === 0) {
      const created = createFlowDocument()
      repository.save([created])
      setDocuments([created])
      setActiveId(created.id)
      return
    }
    setDocuments(loaded)
    setActiveId(loaded[0]?.id ?? null)
  }, [])

  // 卸载前把防抖中的文档落盘
  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current)
        const latest = documentsRef.current
        if (latest !== null) createFlowDocumentRepository(window.localStorage).save(latest)
      }
    }
  }, [])

  const persist = useCallback((next: FlowDocument[]) => {
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      createFlowDocumentRepository(window.localStorage).save(next)
    }, PERSIST_DEBOUNCE_MS)
  }, [])

  // Agent 列表与自定义配置数据源：登录后拉取；models/tools/skills 失败不阻断预设模式，只影响自定义表单
  useEffect(() => {
    if (userId === null) return
    let active = true
    setAgentsFailed(false)
    void (async () => {
      try {
        const [agentList, modelList, toolList, skillList] = await Promise.all([
          getRuntimeAgents(),
          listUserModels().catch(() => []),
          listAiTools().catch(() => []),
          listEnabledSkills().catch(() => []),
        ])
        if (!active) return
        setAgents(agentList.items)
        setModels(modelList)
        setTools(toolList)
        setSkills(skillList)
      } catch {
        if (!active) return
        setAgentsFailed(true)
      }
    })()
    return () => {
      active = false
    }
  }, [userId, agentsAttempt])

  const activeDocument = useMemo(
    () => documents?.find((document) => document.id === activeId) ?? null,
    [documents, activeId],
  )

  /** 拓扑校验结果：链上序号映射与运行前的图结构都从这里取。 */
  const graph = useMemo(() => (activeDocument === null ? null : validateFlowGraph(activeDocument)), [activeDocument])
  const chainIndex = useMemo(() => {
    const map = new Map<string, number>()
    if (graph?.ok) graph.chain.steps.forEach((step, index) => map.set(step.node.id, index))
    return map
  }, [graph])

  const agentNames = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents])

  const stepStates = useMemo(() => {
    const map: Record<string, FlowStepRunState> = {}
    flowRun.run?.steps.forEach((step) => {
      map[step.nodeId] = step
    })
    return map
  }, [flowRun.run])

  const updateActiveDocument = useCallback(
    (updater: (document: FlowDocument) => FlowDocument) => {
      const current = documentsRef.current
      if (current === null) return
      const next = current.map((document) => (document.id === activeId ? touchDocument(updater(document)) : document))
      setDocuments(next)
      persist(next)
    },
    [activeId, persist],
  )

  const handleDocumentChange = useCallback(
    (changes: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      updateActiveDocument((document) => ({ ...document, nodes: changes.nodes, edges: changes.edges }))
    },
    [updateActiveDocument],
  )

  const handleInputTextChange = useCallback(
    (nodeId: string, text: string) => {
      updateActiveDocument((document) => ({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === nodeId && node.type === 'input' ? { ...node, data: { ...node.data, inputText: text } } : node,
        ),
      }))
    },
    [updateActiveDocument],
  )

  const handleAgentIdChange = useCallback(
    (nodeId: string, agentId: string) => {
      updateActiveDocument((document) => ({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === nodeId && node.type === 'agent' ? { ...node, data: { ...node.data, agentId } } : node,
        ),
      }))
    },
    [updateActiveDocument],
  )

  /** 模式切换：自定义写入默认内联配置，预设删掉 config 字段（回到旧文档形态）。 */
  const handleModeChange = useCallback(
    (nodeId: string, custom: boolean) => {
      updateActiveDocument((document) => ({
        ...document,
        nodes: document.nodes.map((node) => {
          if (node.id !== nodeId || node.type !== 'agent') return node
          const { config: _config, ...rest } = node.data
          return {
            ...node,
            data: custom ? { ...rest, config: createFlowAgentInlineConfig() } : rest,
          }
        }),
      }))
    },
    [updateActiveDocument],
  )

  const handleConfigChange = useCallback(
    (nodeId: string, config: FlowAgentInlineConfig) => {
      updateActiveDocument((document) => ({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === nodeId && node.type === 'agent' ? { ...node, data: { ...node.data, config } } : node,
        ),
      }))
    },
    [updateActiveDocument],
  )

  const handlePromptTemplateChange = useCallback(
    (nodeId: string, promptTemplate: string) => {
      updateActiveDocument((document) => ({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === nodeId && node.type === 'agent' ? { ...node, data: { ...node.data, promptTemplate } } : node,
        ),
      }))
    },
    [updateActiveDocument],
  )

  const handleRenameDocument = useCallback(
    (name: string) => {
      updateActiveDocument((document) => ({ ...document, name: name.trim().slice(0, 120) }))
    },
    [updateActiveDocument],
  )

  const handleSelectDocument = useCallback(
    (documentId: string) => {
      if (documentId === activeId) return
      flowRun.reset()
      setActiveId(documentId)
      setSelectedNodeId(null)
      setValidationErrors([])
      setImportError(null)
    },
    [activeId, flowRun],
  )

  const handleCreateDocument = useCallback(() => {
    const created = createFlowDocument()
    const next = [created, ...(documentsRef.current ?? [])]
    setDocuments(next)
    persist(next)
    flowRun.reset()
    setActiveId(created.id)
    setSelectedNodeId(null)
    setValidationErrors([])
    setImportError(null)
  }, [flowRun, persist])

  const handleLoadTemplate = useCallback(
    (templateId: string) => {
      const tpl = BUILTIN_FLOW_TEMPLATES.find((t) => t.id === templateId)
      if (!tpl) return
      const created = tpl.createDocument()
      const next = [created, ...(documentsRef.current ?? [])]
      setDocuments(next)
      persist(next)
      flowRun.reset()
      setActiveId(created.id)
      setSelectedNodeId(null)
      setValidationErrors([])
      setImportError(null)
    },
    [flowRun, persist],
  )

  const handleDuplicateDocument = useCallback(
    (documentId: string) => {
      const source = documentsRef.current?.find((document) => document.id === documentId)
      if (source === undefined) return
      const copy = duplicateFlowDocument(source)
      const next = [copy, ...(documentsRef.current ?? [])]
      setDocuments(next)
      persist(next)
      flowRun.reset()
      setActiveId(copy.id)
      setSelectedNodeId(null)
      setValidationErrors([])
      setImportError(null)
    },
    [flowRun, persist],
  )

  const handleRenameSidebarDocument = useCallback(
    (documentId: string, name: string) => {
      const next = (documentsRef.current ?? []).map((document) =>
        document.id === documentId ? touchDocument({ ...document, name }) : document,
      )
      setDocuments(next)
      persist(next)
    },
    [persist],
  )

  const handleDeleteDocument = useCallback(
    (documentId: string) => {
      const current = documentsRef.current
      if (current === null) return
      const next = current.filter((document) => document.id !== documentId)
      if (next.length === 0) {
        // 删到空列表时重建一份初始文档，避免空态
        const created = createFlowDocument()
        setDocuments([created])
        persist([created])
        flowRun.reset()
        setActiveId(created.id)
        setSelectedNodeId(null)
      } else {
        setDocuments(next)
        persist(next)
        if (documentId === activeId) {
          flowRun.reset()
          setActiveId(next[0]?.id ?? null)
          setSelectedNodeId(null)
        }
      }
      setValidationErrors([])
      setImportError(null)
    },
    [activeId, flowRun, persist],
  )

  const handleExport = useCallback(() => {
    if (activeDocument === null) return
    const blob = new Blob([serializeFlowDocument(activeDocument)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeDocument.name}.flow.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [activeDocument])

  const handleImport = useCallback(
    (file: File) => {
      setImportError(null)
      void (async () => {
        let imported: FlowDocument
        try {
          imported = parseFlowImport(await file.text())
        } catch (error) {
          // 非法文件只报错，不落库
          setImportError(error instanceof Error ? error.message : '导入失败，文件无法解析。')
          return
        }
        const next = [imported, ...(documentsRef.current ?? [])]
        setDocuments(next)
        persist(next)
        flowRun.reset()
        setActiveId(imported.id)
        setSelectedNodeId(null)
        setValidationErrors([])
      })()
    },
    [flowRun, persist],
  )

  /** 运行：拓扑校验 → 模板静态校验 → 配置校验 → 启动执行引擎。 */
  const handleRun = useCallback(() => {
    if (activeDocument === null) return
    setImportError(null)

    const graphResult = validateFlowGraph(activeDocument)
    if (!graphResult.ok) {
      setValidationErrors(graphResult.errors)
      return
    }
    const templates = graphResult.chain.steps.map((step) => step.node.data.promptTemplate)
    const templateErrors = validateStepTemplates(templates)
    if (templateErrors.length > 0) {
      setValidationErrors(templateErrors)
      return
    }
    const missingAgent = graphResult.chain.steps.find(
      (step) => step.node.data.config === undefined && step.node.data.agentId.length === 0,
    )
    if (missingAgent !== undefined) {
      setValidationErrors(['有 Agent 节点还没有选择 Agent，请点击节点在右侧配置。'])
      return
    }
    const missingInline = graphResult.chain.steps.find(
      (step) =>
        step.node.data.config !== undefined &&
        (step.node.data.config.model === null || step.node.data.config.systemPrompt.trim().length === 0),
    )
    if (missingInline !== undefined) {
      setValidationErrors(['有自定义节点还没有选模型或没写系统提示词，请点击节点在右侧配置。'])
      return
    }
    const inputNode = activeDocument.nodes.find((node) => node.id === graphResult.chain.inputNodeId)
    const input = inputNode !== undefined && inputNode.type === 'input' ? inputNode.data.inputText.trim() : ''
    if (input.length === 0) {
      setValidationErrors(['起点输入为空，请先在输入节点里填写内容。'])
      return
    }

    setValidationErrors([])
    void flowRun.start({
      documentName: activeDocument.name,
      input,
      steps: graphResult.chain.steps.map((step) => ({
        nodeId: step.node.id,
        target:
          step.node.data.config !== undefined
            ? {
                config: {
                  model: step.node.data.config.model as { providerId: string; modelId: string },
                  systemPrompt: step.node.data.config.systemPrompt,
                  skillIds: step.node.data.config.skillIds,
                  toolRefs: step.node.data.config.toolRefs,
                  outputContract: null,
                  outputMode: 'optional',
                  thinkingLevel: step.node.data.config.thinkingLevel,
                  maxTurns: step.node.data.config.maxTurns,
                },
              }
            : { agentId: step.node.data.agentId },
        promptTemplate: step.node.data.promptTemplate,
      })),
    })
  }, [activeDocument, flowRun])

  const handleRetryFrom = useCallback(
    (nodeId: string) => {
      flowRun.retryFrom(nodeId)
    },
    [flowRun],
  )

  const handleStop = useCallback(() => {
    void flowRun.stop()
  }, [flowRun])

  if (isPending) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center border border-border bg-surface p-8">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          正在读取登录状态…
        </p>
      </div>
    )
  }

  if (!session?.user) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center border border-border bg-surface p-8 text-center">
        <div className="grid size-12 place-items-center border border-border bg-surface-muted text-primary shadow-sm">
          <LogIn aria-hidden="true" size={22} />
        </div>
        <h2 className="mt-4 text-base font-semibold text-foreground">需要登录使用</h2>
        <p className="mt-2 max-w-sm text-xs text-muted-foreground">
          流程编排需要登录后使用，Agent 运行记录将保存在当前账户下。
        </p>
        <Button asChild className="mt-5" variant="default">
          <Link href="/login">前往登录</Link>
        </Button>
      </div>
    )
  }

  if (documents === null || activeDocument === null) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center border border-border bg-surface p-8">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          正在加载流程文档…
        </p>
      </div>
    )
  }

  const selectedNode = activeDocument.nodes.find((node) => node.id === selectedNodeId) ?? null
  const running = flowRun.run?.status === 'running'
  // runId 在 run.started 事件到达后才有；那之前 abort 接口没有目标，停止按钮保持禁用
  const currentStep = flowRun.run?.steps.find((step) => step.status === 'running')
  const canStop = running && currentStep?.runId != null

  return (
    <div
      className={cn(
        'flex h-full w-full overflow-hidden border border-border bg-card/60 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      {!isLeftCollapsed ? (
        <FlowSidebar
          activeId={activeId}
          className="hidden md:flex"
          documents={documents}
          onCreate={handleCreateDocument}
          onDelete={handleDeleteDocument}
          onDuplicate={handleDuplicateDocument}
          onLoadTemplate={handleLoadTemplate}
          onRename={handleRenameSidebarDocument}
          onSelect={handleSelectDocument}
          onToggleCollapse={() => setIsLeftCollapsed(true)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col bg-surface/40">
        {/* 小屏降级提示：画布交互桌面优先 */}
        <div className="p-6 text-center text-xs text-muted-foreground md:hidden">
          流程画布需要更大的屏幕，请在桌面端使用。
        </div>

        <div className="hidden min-h-0 flex-1 md:flex">
          <FlowCanvas
            agentNames={agentNames}
            canStop={canStop}
            chainIndex={chainIndex}
            document={activeDocument}
            isLeftCollapsed={isLeftCollapsed}
            isRightCollapsed={isRightCollapsed}
            onDocumentChange={handleDocumentChange}
            onExport={handleExport}
            onImport={handleImport}
            onInputTextChange={handleInputTextChange}
            onRename={handleRenameDocument}
            onRun={handleRun}
            onSelectNode={setSelectedNodeId}
            onStop={handleStop}
            onToggleLeftCollapse={() => setIsLeftCollapsed(false)}
            onToggleRightCollapse={() => setIsRightCollapsed((val) => !val)}
            running={running}
            selectedNodeId={selectedNodeId}
            stepStates={stepStates}
            stopping={flowRun.stopping}
          />
        </div>

        {/* 提示区：运行通知、校验错误、导入错误 */}
        {flowRun.notice !== null || validationErrors.length > 0 || importError !== null || agentsFailed ? (
          <div className="border-t border-border bg-surface-muted/90 px-4 py-2.5 text-xs" role="status">
            {flowRun.notice !== null ? (
              <div className="flex items-center justify-between gap-2">
                <p className={flowRun.notice.kind === 'error' ? 'text-danger' : 'text-foreground'}>
                  {flowRun.notice.message}
                </p>
                {flowRun.notice.kind === 'auth' ? (
                  <Button asChild size="sm" variant="link">
                    <Link href="/login">重新登录</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
            {validationErrors.length > 0 ? (
              <div className="space-y-1">
                {validationErrors.map((message) => (
                  <p className="text-danger" key={message}>
                    {message}
                  </p>
                ))}
              </div>
            ) : null}
            {importError !== null ? <p className="text-danger">{importError}</p> : null}
            {agentsFailed ? (
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-danger">
                  <AlertCircle aria-hidden="true" size={13} />
                  Agent 列表加载失败，无法选择 Agent。
                </p>
                <Button
                  onClick={() => setAgentsAttempt((count) => count + 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw aria-hidden="true" size={13} />
                  重试
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {!isRightCollapsed ? (
        <FlowInspector
          agents={agents}
          chainIndex={chainIndex}
          models={models}
          skills={skills}
          tools={tools}
          onAgentIdChange={handleAgentIdChange}
          onConfigChange={handleConfigChange}
          onInputTextChange={handleInputTextChange}
          onModeChange={handleModeChange}
          onPromptTemplateChange={handlePromptTemplateChange}
          onRetryFrom={handleRetryFrom}
          onToggleCollapse={() => setIsRightCollapsed(true)}
          running={running}
          selectedNode={selectedNode}
          stepStates={stepStates}
        />
      ) : null}
    </div>
  )
}
