'use client'

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { LogIn } from 'lucide-react'

import { Textarea } from '@web/components/ui/textarea'
import { cn } from '@web/lib/utils'

export type FlowInputNodeData = {
  inputText: string
  onInputTextChange: (text: string) => void
}

export type FlowInputNode = Node<FlowInputNodeData, 'input'>

/**
 * 输入节点：起点输入直接写在节点里，运行时从这里取值。
 * 交互元素加 nodrag，避免在文本框里按下时拖动节点。
 */
export function FlowNodeInput({ data, selected }: NodeProps<FlowInputNode>) {
  return (
    <div
      className={cn(
        'w-64 border bg-surface shadow-sm transition-colors',
        selected ? 'border-primary' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-xs font-medium text-foreground">
        <LogIn aria-hidden="true" className="text-primary" size={14} />
        起点输入
      </div>
      <div className="p-3">
        <Textarea
          className="nodrag min-h-24 text-xs"
          onChange={(event) => data.onInputTextChange(event.target.value)}
          placeholder="运行流程时，这里的内容作为起点输入"
          value={data.inputText}
        />
      </div>
      <Handle position={Position.Right} type="source" />
    </div>
  )
}
