'use client'

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { LogIn, Plus, Sparkles, Trash2 } from 'lucide-react'

import { ClickSpark } from '@web/components/react-bits/click-spark'
import { Magnet } from '@web/components/react-bits/magnet'
import { SpotlightCard } from '@web/components/react-bits/spotlight-card'
import { Textarea } from '@web/components/ui/textarea'
import { FLOW_INPUT_SAMPLES } from '@web/lib/flow/flow-presets'
import { cn } from '@web/lib/utils'

export type FlowInputNodeData = {
  inputText: string
  onInputTextChange: (text: string) => void
  onQuickAddNext?: (sourceNodeId: string) => void
  onDelete?: (nodeId: string) => void
}

export type FlowInputNode = Node<FlowInputNodeData, 'input'>

/**
 * 输入节点：起点输入直接写在节点里，运行时从这里取值。
 * 交互元素加 nodrag，避免在文本框里按下时拖动节点。
 */
export function FlowNodeInput({ id, data, selected }: NodeProps<FlowInputNode>) {
  return (
    <SpotlightCard
      className={cn(
        'group relative w-80 border bg-surface shadow-sm transition-all duration-200',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border',
      )}
      spotlightColor="rgba(235, 111, 146, 0.12)"
      spotlightRadius={180}
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2 text-xs font-medium text-foreground">
        <div className="flex items-center gap-2">
          <LogIn aria-hidden="true" className="text-primary" size={14} />
          <span>起点输入</span>
        </div>

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

      <div className="space-y-2 p-3">
        <Textarea
          className="nodrag min-h-24 resize-none text-xs leading-relaxed"
          onChange={(event) => data.onInputTextChange(event.target.value)}
          placeholder="运行流程时，这里的内容作为起点输入..."
          value={data.inputText}
        />

        {/* 快速填入测试示例 */}
        {data.inputText.trim().length === 0 ? (
          <div className="nodrag space-y-1">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Sparkles aria-hidden="true" className="text-primary" size={10} />
              填入示例：
            </span>
            <div className="flex flex-wrap gap-1">
              {FLOW_INPUT_SAMPLES.map((sample) => (
                <button
                  className="rounded border border-border bg-surface-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                  key={sample.id}
                  onClick={() => data.onInputTextChange(sample.content)}
                  title={sample.content}
                  type="button"
                >
                  {sample.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

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
