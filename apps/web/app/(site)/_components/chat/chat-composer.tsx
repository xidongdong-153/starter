'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { CornerDownLeft, Send, Sparkles, Square, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useRef } from 'react'

import { Button } from '@web/components/ui/button'
import { Textarea } from '@web/components/ui/textarea'
import { cn } from '@web/lib/utils'

const QUICK_PROMPTS = [
  { label: '润色文本', prefix: '请帮我润色以下文本，使其表达更加自然、通顺且具有专业度：\n\n' },
  { label: '提炼重点', prefix: '请对以下内容进行深度提炼，列出核心观点和关键执行项：\n\n' },
  { label: '代码审查', prefix: '请作为资深工程师审查以下代码，指出潜在隐患与优化建议：\n\n```\n' },
  { label: '翻译英文', prefix: '请将以下中文翻译为准确、地道的英文技术文档表达：\n\n' },
  { label: '单测生成', prefix: '请基于以下业务逻辑编写覆盖边界用例的 Vitest 单元测试：\n\n' },
]

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
 * 提供快捷 Prompt 标签、多行文本自适应输入、清空按钮、快捷键提示与发送/停止操作。
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canSend = !running && text.trim().length > 0 && agentId.length > 0

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (canSend) onSend()
  }

  function handleQuickPrompt(prefix: string) {
    const next = text ? `${text}\n\n${prefix}` : prefix
    onTextChange(next)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }

  function handleClear() {
    onTextChange('')
    textareaRef.current?.focus()
  }

  return (
    <div className={cn('shrink-0 border-t border-border bg-surface/95 p-3.5 backdrop-blur-md md:p-4', className)}>
      <div className="mx-auto max-w-3xl space-y-2.5">
        {/* 快捷 Prompt 标签栏 */}
        {!running && agents.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground mr-1">
              <Sparkles aria-hidden="true" size={11} className="text-primary" />
              <span>快捷指令:</span>
            </span>
            {QUICK_PROMPTS.map((item, idx) => (
              <button
                className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                key={idx}
                onClick={() => handleQuickPrompt(item.prefix)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="relative">
          <label className="sr-only" htmlFor="chat-composer-textarea">
            输入消息
          </label>
          <Textarea
            className="min-h-20 resize-none bg-background pr-10 text-xs leading-5 md:min-h-24 md:text-sm"
            disabled={running}
            id="chat-composer-textarea"
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              agents.length === 0
                ? '暂无可用的 Agent，请先在 Admin 后台启用…'
                : '输入消息… (Enter 发送，Shift + Enter 换行)'
            }
            ref={textareaRef}
            rows={3}
            value={text}
          />

          {/* 清空按钮 */}
          {text.length > 0 && !running ? (
            <button
              aria-label="清空输入"
              className="absolute right-2.5 top-2.5 grid size-6 place-items-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              onClick={handleClear}
              title="清空输入"
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          ) : null}
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
