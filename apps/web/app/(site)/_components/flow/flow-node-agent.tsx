'use client'

import { AlertCircle, Bot, CheckCircle2, CircleStop, Loader2 } from 'lucide-react'

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

import { Badge } from '@web/components/ui/badge'
import type { FlowStepRunState } from '@web/lib/flow/flow-run'
import { cn } from '@web/lib/utils'

export type FlowAgentNodeData = {
  agentId: string
  promptTemplate: string
  /** 链上序号（从 0 计）；没连进链时为 null。 */
  stepIndex: number | null
  agentName: string | null
  runState: FlowStepRunState | null
  isSelected: boolean
}

export type FlowAgentNode = Node<FlowAgentNodeData, 'agent'>

const statusStyles: Record<string, string> = {
  completed: 'border-success/70',
  failed: 'border-danger/70',
  running: 'border-primary animate-pulse',
  aborted: 'border-warning/70',
  idle: 'border-border',
}

/**
 * Agent 节点：显示链上序号、所选 Agent、运行状态与产出预览。
 * 完整配置和产出全文在选中节点后的右侧 inspector 面板里编辑。
 */
export function FlowNodeAgent({ data }: NodeProps<FlowAgentNode>) {
  const runState = data.runState
  const status = runState?.status ?? 'idle'

  return (
    <div
      className={cn(
        'w-72 border bg-surface shadow-sm transition-colors',
        statusStyles[status] ?? 'border-border',
        data.isSelected ? 'border-primary' : undefined,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Bot aria-hidden="true" className="text-primary" size={14} />
          Agent{data.stepIndex !== null ? ` ${data.stepIndex + 1}` : ''}
        </div>
        {status === 'running' ? (
          <Badge className="gap-1 border-primary/30 bg-primary/10 text-[10px] text-primary" variant="outline">
            <Loader2 aria-hidden="true" className="animate-spin" size={10} />
            运行中
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
      </div>

      <div className="space-y-1.5 px-3 py-2.5">
        <p className="truncate text-xs text-foreground">
          {data.agentId.length === 0 ? (
            <span className="text-warning">未选择 Agent，点击节点后在右侧配置</span>
          ) : (
            (data.agentName ?? data.agentId)
          )}
        </p>
        {runState?.output !== null && runState?.output !== undefined && runState.output.length > 0 ? (
          <p className="line-clamp-2 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
            {runState.output}
          </p>
        ) : null}
        {runState?.status === 'failed' && runState.errorMessage !== null ? (
          <p className="line-clamp-2 text-[11px] leading-5 text-danger">{runState.errorMessage}</p>
        ) : null}
      </div>

      <Handle position={Position.Left} type="target" />
      <Handle position={Position.Right} type="source" />
    </div>
  )
}
