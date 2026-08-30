'use client'

import type { AgentDefinitionSummary } from '@starter/contracts'
import { CornerDownLeft, ImagePlus, Loader2, Send, Sparkles, Square, X } from 'lucide-react'
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import { useRef, useState } from 'react'

import { Button } from '@web/components/ui/button'
import { Textarea } from '@web/components/ui/textarea'
import type { ChatAttachmentItem } from '@web/hooks/use-chat-attachments'
import { ATTACHMENT_ACCEPT } from '@web/lib/ai/attachment-input'
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
  /** 待发送的图片附件；上传中的项只显示占位。 */
  attachments: ChatAttachmentItem[]
  /** 附件预校验或上传失败的提示，下一次操作时刷新。 */
  attachmentError: string | null
  canStop: boolean
  onAttachFiles: (files: File[]) => void
  onRemoveAttachment: (key: string) => void
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
 * 提供快捷 Prompt 标签、多行文本自适应输入、清空按钮、快捷键提示与发送/停止操作；
 * 支持图片附件：文件选择、粘贴、拖拽进入后立即上传，缩略图进入待发送区。
 */
export function ChatComposer({
  agentId,
  agents,
  attachments,
  attachmentError,
  canStop,
  onAttachFiles,
  onRemoveAttachment,
  onSend,
  onStop,
  onTextChange,
  running,
  stopping,
  text,
  className,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const hasUploading = attachments.some((item) => item.status === 'uploading')
  const canSend = !running && !hasUploading && text.trim().length > 0 && agentId.length > 0

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

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    onAttachFiles(Array.from(event.target.files ?? []))
    // 允许再次选择同一个文件。
    event.target.value = ''
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (running) return
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    onAttachFiles(files)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // 拖文本时不高亮，只有拖文件才进入附件流程。
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave() {
    setDragActive(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    if (running) return
    onAttachFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      className={cn(
        'shrink-0 border-t border-border bg-surface/95 p-3.5 backdrop-blur-md transition-colors md:p-4',
        dragActive && 'border-t-primary bg-surface-muted',
        className,
      )}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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
            onPaste={handlePaste}
            placeholder={
              agents.length === 0
                ? '暂无可用的 Agent，请先在 Admin 后台启用…'
                : '输入消息… (Enter 发送，Shift + Enter 换行，可粘贴或拖入图片)'
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

        {/* 待发送附件区：上传中显示占位，完成后显示缩略图 */}
        {attachments.length > 0 || attachmentError !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            {attachments.map((item) =>
              item.status === 'uploading' ? (
                <div
                  className="flex h-14 max-w-48 items-center gap-1.5 rounded border border-border bg-surface-muted px-2.5 text-[11px] text-muted-foreground"
                  key={item.key}
                >
                  <Loader2 aria-hidden="true" className="shrink-0 animate-spin" size={12} />
                  <span className="truncate">{item.name}</span>
                </div>
              ) : (
                <div className="group relative" key={item.key}>
                  <img
                    alt={item.name}
                    className="size-14 rounded border border-border bg-surface-muted object-cover"
                    src={item.url ?? undefined}
                  />
                  <button
                    aria-label={`移除图片 ${item.name}`}
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-surface text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                    onClick={() => onRemoveAttachment(item.key)}
                    title="移除图片"
                    type="button"
                  >
                    <X aria-hidden="true" size={11} />
                  </button>
                </div>
              ),
            )}
            {attachmentError !== null ? (
              <p className="text-[11px] text-danger" role="alert">
                {attachmentError}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Button
              aria-label="上传图片"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              disabled={running}
              onClick={() => fileInputRef.current?.click()}
              title="上传图片（也可粘贴或拖入）"
              type="button"
              variant="ghost"
            >
              <ImagePlus aria-hidden="true" size={13} />
              图片
            </Button>
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

      {/* 隐藏的图片选择入口 */}
      <input
        accept={ATTACHMENT_ACCEPT}
        aria-label="选择图片文件"
        className="sr-only"
        multiple
        onChange={handleFileSelect}
        ref={fileInputRef}
        type="file"
      />
    </div>
  )
}
