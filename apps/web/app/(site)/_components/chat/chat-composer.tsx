'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { CornerDownLeft, Send, Square } from 'lucide-react'
import type { KeyboardEvent } from 'react'

import { Button } from '@web/components/ui/button'
import { Textarea } from '@web/components/ui/textarea'
import { cn } from '@web/lib/utils'

export interface ChatComposerProps {
  agentId: string
  agents: AgentDefinitionSummary[]
  canStop: boolean
  onSend: () => void
  onStop: () => void
  onTextChange: (text: string) => void
  running: boolean
  stopping: boolean
  text: string
  className?: string
}

/**
 * Chat 底部输入区：
 * 固定吸附在对话主区底部，提供多行文本自适应输入、快捷键提示与发送/停止操作。
 */
export function ChatComposer({
  agentId,
  agents,
  canStop,
  onSend,
  onStop,
  onTextChange,
  running,
  stopping,
  text,
  className,
}: ChatComposerProps) {
  const canSend = !running && text.trim().length > 0 && agentId.length > 0

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (canSend) onSend()
  }

  return (
    <div className={cn('shrink-0 border-t border-border bg-surface/95 p-3.5 backdrop-blur-md md:p-4', className)}>
      <div className="mx-auto max-w-3xl space-y-2.5">
        <div className="relative">
          <label className="sr-only" htmlFor="chat-composer-textarea">
            输入消息
          </label>
          <Textarea
            className="min-h-20 resize-none bg-background pr-12 text-xs leading-5 md:min-h-24 md:text-sm"
            disabled={running}
            id="chat-composer-textarea"
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              agents.length === 0
                ? '暂无可用的 Agent，请先在 Admin 后台启用…'
                : '输入消息… (Enter 发送，Shift + Enter 换行)'
            }
            rows={3}
            value={text}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CornerDownLeft aria-hidden="true" size={13} />
            <span>Enter 发送 / Shift + Enter 换行</span>
          </div>

          <div className="flex items-center gap-2">
            {running ? (
              <Button
                className="h-9 gap-1.5 px-3 text-xs"
                disabled={stopping || !canStop}
                onClick={onStop}
                title={canStop ? undefined : '等待任务启动后可停止'}
                type="button"
                variant="destructive"
              >
                <Square aria-hidden="true" size={14} />
                {stopping ? '正在停止…' : '停止生成'}
              </Button>
            ) : (
              <Button className="h-9 gap-1.5 px-4 text-xs" disabled={!canSend} onClick={onSend} type="button">
                <Send aria-hidden="true" size={14} />
                发送
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
