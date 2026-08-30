'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { AlertCircle, CheckCircle2, ChevronRight, CircleStop, RotateCcw } from 'lucide-react'
import { useRef } from 'react'

import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import { Label } from '@web/components/ui/label'
import { Textarea } from '@web/components/ui/textarea'
import type { FlowNode } from '@web/lib/flow/flow-document'
import type { FlowStepRunState } from '@web/lib/flow/flow-run'
import { availableVariables } from '@web/lib/flow/flow-template'
import { cn } from '@web/lib/utils'

const selectClass =
  'h-11 w-full border border-input bg-surface px-2.5 text-sm transition-colors outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60'

export interface FlowInspectorProps {
  selectedNode: FlowNode | null
  agents: AgentDefinitionSummary[]
  /** 链上序号，nodeId → 从 0 计的步骤序号。 */
  chainIndex: Map<string, number>
  /** 运行态，nodeId → 步骤状态。 */
  stepStates: Record<string, FlowStepRunState>
  running: boolean
  onAgentIdChange: (nodeId: string, agentId: string) => void
  onPromptTemplateChange: (nodeId: string, template: string) => void
  onInputTextChange: (nodeId: string, text: string) => void
  onRetryFrom: (nodeId: string) => void
  onToggleCollapse?: () => void
  className?: string
}

/**
 * 右侧检查面板：选中 Agent 节点时编辑配置（Agent 选择、Prompt 模板、变量插入），
 * 并显示该节点的运行态、产出全文和错误信息；选中输入节点时编辑起点输入；支持折叠收起。
 */
export function FlowInspector({
  selectedNode,
  agents,
  chainIndex,
  stepStates,
  running,
  onAgentIdChange,
  onPromptTemplateChange,
  onInputTextChange,
  onRetryFrom,
  onToggleCollapse,
  className,
}: FlowInspectorProps) {
  const templateRef = useRef<HTMLTextAreaElement>(null)

  if (selectedNode === null) {
    return (
      <aside
        aria-label="节点配置面板"
        className={cn(
          'hidden w-80 shrink-0 flex-col border-l border-border bg-surface-muted/40 transition-all lg:flex',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <span className="text-xs font-semibold text-foreground">配置与详情</span>
          {onToggleCollapse ? (
            <Button
              aria-label="收起检查面板"
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapse}
              size="icon"
              title="收起检查面板"
              type="button"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" size={15} />
            </Button>
          ) : null}
        </div>
        <div className="flex h-full items-center justify-center p-6 text-center">
          <p className="text-xs text-muted-foreground">点击画布上的节点，在这里配置和查看运行产出。</p>
        </div>
      </aside>
    )
  }

  if (selectedNode.type === 'input') {
    return (
      <aside
        aria-label="输入节点配置"
        className={cn(
          'hidden w-80 shrink-0 flex-col border-l border-border bg-surface-muted/40 transition-all lg:flex',
          className,
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-xs font-semibold text-foreground">起点输入配置</span>
          {onToggleCollapse ? (
            <Button
              aria-label="收起检查面板"
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapse}
              size="icon"
              title="收起检查面板"
              type="button"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" size={15} />
            </Button>
          ) : null}
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <Label className="text-xs" htmlFor="flow-input-text">
            输入内容
          </Label>
          <Textarea
            className="mt-1.5 min-h-40 text-xs"
            id="flow-input-text"
            onChange={(event) => onInputTextChange(selectedNode.id, event.target.value)}
            placeholder="运行流程时，这里的内容作为起点输入"
            value={selectedNode.data.inputText}
          />
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            模板变量 <code className="text-foreground">{'{{input}}'}</code> 引用这里的内容。
          </p>
        </div>
      </aside>
    )
  }

  const stepIndex = chainIndex.get(selectedNode.id) ?? null
  const runState = stepStates[selectedNode.id] ?? null
  const variables = stepIndex === null ? ['{{input}}'] : availableVariables(stepIndex)
  const canRetry = !running && (runState?.status === 'failed' || runState?.status === 'aborted')

  function insertVariable(variable: string) {
    const element = templateRef.current
    const template = selectedNode !== null && selectedNode.type === 'agent' ? selectedNode.data.promptTemplate : ''
    if (element === null || selectedNode === null || selectedNode.type !== 'agent') {
      onPromptTemplateChange(selectedNode?.id ?? '', template + variable)
      return
    }
    const start = element.selectionStart ?? template.length
    const end = element.selectionEnd ?? template.length
    const next = `${template.slice(0, start)}${variable}${template.slice(end)}`
    onPromptTemplateChange(selectedNode.id, next)
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + variable.length, start + variable.length)
    })
  }

  return (
    <aside
      aria-label="Agent 节点配置"
      className={cn(
        'hidden w-80 shrink-0 flex-col border-l border-border bg-surface-muted/40 transition-all lg:flex',
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-foreground">
            Agent 节点{stepIndex !== null ? ` ${stepIndex + 1}` : ''}
          </h2>
          {runState !== null ? <RunStateBadge status={runState.status} /> : null}
        </div>
        {onToggleCollapse ? (
          <Button
            aria-label="收起检查面板"
            className="size-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={onToggleCollapse}
            size="icon"
            title="收起检查面板"
            type="button"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" size={15} />
          </Button>
        ) : null}
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <Label className="text-xs" htmlFor="flow-agent-select">
            Agent
          </Label>
          <select
            className={cn(selectClass, 'mt-1.5')}
            id="flow-agent-select"
            onChange={(event) => onAgentIdChange(selectedNode.id, event.target.value)}
            value={selectedNode.data.agentId}
          >
            <option value="">选择 Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          {selectedNode.data.agentId.length === 0 ? (
            <p className="mt-1.5 text-[11px] text-warning">尚未选择 Agent，运行前需要先选择。</p>
          ) : null}
        </div>

        <div>
          <Label className="text-xs" htmlFor="flow-prompt-template">
            Prompt 模板
          </Label>
          <Textarea
            className="mt-1.5 min-h-48 font-mono text-xs"
            id="flow-prompt-template"
            onChange={(event) => onPromptTemplateChange(selectedNode.id, event.target.value)}
            placeholder="支持 {{input}} 和 {{steps.N.output}} 变量"
            ref={templateRef}
            value={selectedNode.data.promptTemplate}
          />
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] text-muted-foreground">可用变量（点击插入）：</p>
            <div className="flex flex-wrap gap-1.5">
              {variables.map((variable) => (
                <button
                  className="border border-border bg-surface px-2 py-1 font-mono text-[11px] text-primary transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  key={variable}
                  onClick={() => insertVariable(variable)}
                  type="button"
                >
                  {variable}
                </button>
              ))}
            </div>
            {stepIndex === null ? (
              <p className="text-[11px] text-muted-foreground">节点未连进流程链，只能使用起点输入。</p>
            ) : null}
          </div>
        </div>

        {runState !== null ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-foreground">运行状态</p>
            {runState.runId !== null ? (
              <p className="break-all text-[11px] text-muted-foreground">Run: {runState.runId}</p>
            ) : null}
            {runState.output !== null && runState.output.length > 0 ? (
              <div>
                <p className="text-[11px] text-muted-foreground">产出：</p>
                <pre className="mt-1 max-h-64 overflow-y-auto border border-border-subtle bg-surface p-2.5 whitespace-pre-wrap text-[11px] leading-5 text-foreground">
                  {runState.output}
                </pre>
              </div>
            ) : null}
            {runState.status === 'failed' ? (
              <p className="text-[11px] leading-5 text-danger">
                {runState.errorMessage ?? `运行失败：${runState.errorCode ?? '未返回错误码'}`}
              </p>
            ) : null}
            {canRetry ? (
              <Button
                className="w-full gap-1.5"
                onClick={() => onRetryFrom(selectedNode.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" size={14} />
                从此节点重试
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function RunStateBadge({ status }: { status: FlowStepRunState['status'] }) {
  if (status === 'completed') {
    return (
      <Badge className="gap-1 border-success/30 bg-success/10 text-[10px] text-success" variant="outline">
        <CheckCircle2 aria-hidden="true" size={10} />
        完成
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge className="gap-1 border-danger/30 bg-danger/10 text-[10px] text-danger" variant="outline">
        <AlertCircle aria-hidden="true" size={10} />
        失败
      </Badge>
    )
  }
  if (status === 'aborted') {
    return (
      <Badge className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning" variant="outline">
        <CircleStop aria-hidden="true" size={10} />
        已停止
      </Badge>
    )
  }
  return (
    <Badge className="text-[10px]" variant="secondary">
      未运行
    </Badge>
  )
}
