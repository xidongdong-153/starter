'use client'

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Clock,
  Loader2,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

import { BorderBeam } from '@web/components/react-bits/border-beam'
import { ClickSpark } from '@web/components/react-bits/click-spark'
import { DecryptedText } from '@web/components/react-bits/decrypted-text'
import { Magnet } from '@web/components/react-bits/magnet'
import { ShinyText } from '@web/components/react-bits/shiny-text'
import { SpotlightCard } from '@web/components/react-bits/spotlight-card'
import { Badge } from '@web/components/ui/badge'
import type { FlowStepRunState } from '@web/lib/flow/flow-run'
import { cn } from '@web/lib/utils'

export type FlowAgentNodeData = {
  agentId: string
  promptTemplate: string
  /** 链上序号（从 0 计）；没连进链时为 null。 */
  stepIndex: number | null
  /** 自定义配置模式：true 时节点用内联配置执行，不显示 Agent 名。 */
  isCustom: boolean
  agentName: string | null
  runState: FlowStepRunState | null
  isSelected: boolean
  onQuickAddNext?: (sourceNodeId: string) => void
  onDelete?: (nodeId: string) => void
}

export type FlowAgentNode = Node<FlowAgentNodeData, 'agent'>

const statusStyles: Record<string, string> = {
  completed: 'border-success/70',
  failed: 'border-danger/70',
  running: 'border-primary ring-2 ring-primary/30 shadow-[0_0_15px_rgba(235,111,146,0.3)]',
  aborted: 'border-warning/70',
  idle: 'border-border',
}

/**
 * Agent 节点：显示链上序号、所选 Agent、运行状态、耗时与产出就地预览。
 * 完整配置和产出全文在选中节点后的右侧 inspector 面板里编辑。
 */
export function FlowNodeAgent({ id, data }: NodeProps<FlowAgentNode>) {
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)
  const runState = data.runState
  const status = runState?.status ?? 'idle'

  const durationText =
    runState?.startedAt && runState?.finishedAt
      ? `${((runState.finishedAt - runState.startedAt) / 1000).toFixed(1)}s`
      : null

  const hasOutput = runState?.output !== null && runState?.output !== undefined && runState.output.length > 0

  return (
    <SpotlightCard
      className={cn(
        'group relative w-80 border bg-surface shadow-sm transition-all duration-200',
        statusStyles[status] ?? 'border-border',
        data.isSelected ? 'border-primary ring-2 ring-primary/20' : undefined,
      )}
      spotlightColor="rgba(235, 111, 146, 0.12)"
      spotlightRadius={200}
    >
      {status === 'running' ? <BorderBeam colorFrom="#eb6f92" colorTo="#c4a7e7" duration={3.5} /> : null}

      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Bot aria-hidden="true" className="text-primary" size={14} />
          <span>Agent{data.stepIndex !== null ? ` ${data.stepIndex + 1}` : ''}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {durationText ? (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock aria-hidden="true" size={10} />
              <DecryptedText maxIterations={5} sequential speed={20} text={durationText} />
            </span>
          ) : null}

          {status === 'running' ? (
            <Badge className="gap-1 border-primary/40 bg-primary/10 text-[10px] text-primary" variant="outline">
              <Loader2 aria-hidden="true" className="animate-spin" size={10} />
              <ShinyText shimmerWidth={160} speed={3.5} text="运行中" />
            </Badge>
          ) : null}
          {status === 'completed' ? (
            <Badge className="gap-1 border-success/30 bg-success/10 text-[10px] text-success" variant="outline">
              <CheckCircle2 aria-hidden="true" size={10} />
              完成
            </Badge>
          ) : null}
          {status === 'failed' ? (
            <Badge className="gap-1 border-danger/30 bg-danger/10 text-[10px] text-danger" variant="outline">
              <AlertCircle aria-hidden="true" size={10} />
              失败
            </Badge>
          ) : null}
          {status === 'aborted' ? (
            <Badge className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning" variant="outline">
              <CircleStop aria-hidden="true" size={10} />
              已停止
            </Badge>
          ) : null}

          {data.onDelete ? (
            <button
              aria-label="删除节点"
              className="nodrag flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-danger"
              onClick={(e) => {
                e.stopPropagation()
                data.onDelete?.(id)
              }}
              title="删除此节点"
              type="button"
            >
              <Trash2 aria-hidden="true" size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <div className="flex items-center justify-between gap-1">
          <p className="truncate text-xs font-medium text-foreground">
            {data.isCustom ? (
              <span className="flex items-center gap-1 text-primary">
                <SlidersHorizontal aria-hidden="true" size={12} />
                自定义配置
              </span>
            ) : data.agentId.length === 0 ? (
              <span className="text-warning">未选择 Agent（点击配置）</span>
            ) : (
              (data.agentName ?? data.agentId)
            )}
          </p>
        </div>

        {data.promptTemplate ? (
          <p className="line-clamp-2 font-mono text-[10px] leading-4 text-muted-foreground/80">{data.promptTemplate}</p>
        ) : null}

        {/* 产出预览与就地展开 */}
        {hasOutput ? (
          <div className="border-t border-border-subtle/80 pt-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>运行产出：</span>
              <button
                className="nodrag flex items-center gap-0.5 text-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsOutputExpanded((open) => !open)
                }}
                type="button"
              >
                <span>{isOutputExpanded ? '收起' : '展开全文'}</span>
                {isOutputExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            </div>
            <pre
              className={cn(
                'nodrag mt-1 rounded bg-surface-muted/70 p-2 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap',
                isOutputExpanded ? 'max-h-56 overflow-y-auto' : 'line-clamp-2',
              )}
            >
              {runState.output}
            </pre>
          </div>
        ) : null}

        {runState?.status === 'failed' && runState.errorMessage !== null ? (
          <p className="line-clamp-2 text-[11px] leading-5 text-danger">{runState.errorMessage}</p>
        ) : null}
      </div>

      <Handle
        className="!size-2.5 !border-2 !border-surface !bg-muted-foreground"
        position={Position.Left}
        type="target"
      />
      <Handle className="!size-2.5 !border-2 !border-surface !bg-primary" position={Position.Right} type="source" />

      {/* 快捷追加下一个 Agent 节点 */}
      {data.onQuickAddNext ? (
        <div className="nodrag absolute -right-3 top-1/2 -translate-y-1/2 z-10">
          <Magnet magnetStrength={0.3} padding={15}>
            <ClickSpark sparkColor="rgba(235, 111, 146, 0.9)" sparkCount={8}>
              <button
                aria-label="快速追加下一个 Agent 节点"
                className="grid size-6 place-items-center rounded-full border border-border bg-surface text-foreground opacity-0 shadow-md transition-all hover:scale-110 hover:border-primary hover:bg-primary hover:text-primary-foreground group-hover:opacity-100 focus-visible:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  data.onQuickAddNext?.(id)
                }}
                title="快速追加并连线下一个 Agent 节点"
                type="button"
              >
                <Plus aria-hidden="true" size={13} />
              </button>
            </ClickSpark>
          </Magnet>
        </div>
      ) : null}
    </SpotlightCard>
  )
}
