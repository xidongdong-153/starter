'use client'

import type { AgentMessageBlock, AgentToolStatus, AgentTranscriptItem } from '@starter/contracts'
import { ArrowDown, Bot, Check, ChevronDown, Copy, Sparkles, User, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import type { ChatTimelineItem } from '@web/lib/ai/chat-events'
import type { PendingChatImage } from '@web/hooks/use-chat-run'
import { cn } from '@web/lib/utils'

import { ChatMarkdown } from './chat-markdown'

/** tool 状态文案，键包含 API 的 tool 终态和流式过程中的 running。 */
const toolStatusLabels: Record<AgentToolStatus | 'running', string> = {
  cancelled: '已取消',
  failed: '失败',
  forbidden: '无权限',
  interrupted: '已中断',
  invalid_arguments: '参数无效',
  not_found: '未找到工具',
  running: '执行中',
  succeeded: '成功',
  timed_out: '超时',
}

const assistantStatusLabels = {
  aborted: '已取消',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
} as const

const STARTER_PROMPTS = [
  {
    title: '代码审查与重构',
    prompt: '请作为资深架构师，帮我审查一段 TypeScript 代码的性能瓶颈与异常边界，并给出优雅的重构方案。',
    desc: '分析潜在隐患、优化类型安全',
  },
  {
    title: '技术方案设计',
    prompt: '我想在 Next.js + Tailwind 全栈项目中实现一套兼顾多端与暗色主题的 Rose Pine 变量系统，请帮我梳理架构方案。',
    desc: '梳理模块职责、数据流与组件树',
  },
  {
    title: '文章摘要与英文简报',
    prompt: '请将以下内容提炼出 3 个核心观点，并将其翻译成结构清晰的英文技术简报：\n\n',
    desc: '要点提取、跨语言技术转化',
  },
]

export interface ChatTimelineProps {
  history: AgentTranscriptItem[]
  /** 发送中用户气泡里展示的图片缩略图；没有图片时为 null。 */
  pendingUserImages: PendingChatImage[] | null
  pendingUserText: string | null
  timeline: ChatTimelineItem[]
  onSelectStarterPrompt?: (prompt: string) => void
  className?: string
}

/**
 * 渲染已持久化的 transcript 历史，再接上当前 Run 的流式视图。
 * 支持 Markdown 渲染、代码高亮复制、图片附件缩略图（点击放大）、置底悬浮按钮与空态用例卡片。
 */
export function ChatTimeline({
  history,
  pendingUserImages,
  pendingUserText,
  timeline,
  onSelectStarterPrompt,
  className,
}: ChatTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isAutoScrollActiveRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const empty = history.length === 0 && pendingUserText === null && timeline.length === 0

  // 监听容器内部滚动，当用户主动向上翻阅历史时暂停自动触底，并显示置底悬浮按钮
  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNearBottom = distanceToBottom <= 80
    isAutoScrollActiveRef.current = isNearBottom
    setShowScrollBottom(distanceToBottom > 120)
  }

  function scrollToBottom() {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    })
  }

  // 依赖内容更新直接滚动内部容器
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (isAutoScrollActiveRef.current) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [history, pendingUserText, timeline])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        aria-label="对话消息流"
        className={cn('flex-1 overflow-y-auto p-4 md:p-6', className)}
        onScroll={handleScroll}
        ref={containerRef}
      >
        {empty ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-4 text-center md:p-8">
            <div className="grid size-12 place-items-center border border-border bg-surface-muted/60 text-primary shadow-sm">
              <Sparkles aria-hidden="true" size={24} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">开始与 Agent 对话</h3>
            <p className="mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
              在下方输入框中键入你的任务，或选择下方开箱即用的示例快速开启对话。
            </p>

            {/* 开箱即用用例卡片 */}
            {onSelectStarterPrompt ? (
              <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
                {STARTER_PROMPTS.map((item, idx) => (
                  <button
                    className="group flex flex-col items-start rounded border border-border bg-surface/80 p-3.5 text-left transition-all hover:border-primary hover:bg-surface-muted/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    key={idx}
                    onClick={() => onSelectStarterPrompt(item.prompt)}
                    type="button"
                  >
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary">{item.title}</span>
                    <span className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{item.desc}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {history.map((item) => (
              <TranscriptRow item={item} key={item.id} />
            ))}

            {pendingUserText === null ? null : (
              <div className="flex items-start justify-end gap-3">
                <div className="group relative max-w-[85%] border border-border bg-surface-muted px-4 py-3 text-sm leading-6 shadow-sm">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <User aria-hidden="true" size={13} />
                    <span>我</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-foreground">{pendingUserText}</p>
                  {pendingUserImages !== null && pendingUserImages.length > 0 ? (
                    <UserMessageImages images={pendingUserImages} />
                  ) : null}
                </div>
              </div>
            )}

            {pendingUserText !== null && timeline.length === 0 ? <PendingAssistantRow /> : null}

            {timeline.map((item) => (
              <LiveRow item={item} key={timelineKey(item)} />
            ))}
          </div>
        )}
      </div>

      {/* 悬浮置底按钮 */}
      {showScrollBottom ? (
        <div className="pointer-events-none absolute bottom-4 right-6 z-20">
          <Button
            aria-label="滚动到底部"
            className="pointer-events-auto shadow-md gap-1.5 text-xs"
            onClick={scrollToBottom}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowDown aria-hidden="true" size={13} />
            <span>回到底部</span>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function TranscriptRow({ item }: { item: AgentTranscriptItem }) {
  if (item.type === 'user_message') {
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="group relative max-w-[85%] border border-border bg-surface-muted px-4 py-3 text-sm leading-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User aria-hidden="true" size={13} />
              <span>我</span>
            </div>
            <CopyButton content={item.content} />
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-foreground">{item.content}</p>
          {item.images !== undefined && item.images.length > 0 ? <UserMessageImages images={item.images} /> : null}
        </div>
      </div>
    )
  }

  if (item.type === 'assistant_message') {
    const blocks: AgentMessageBlock[] = item.blocks ?? [{ text: item.content, type: 'text' }]
    return (
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center border border-border bg-surface text-primary shadow-sm">
          <Bot aria-hidden="true" size={16} />
        </div>
        <div className="group relative min-w-0 flex-1 border border-border-subtle bg-surface px-4 py-3.5 text-sm leading-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">助手</span>
              {item.status === 'completed' ? null : (
                <Badge className="text-[10px]" variant="secondary">
                  {assistantStatusLabels[item.status]}
                </Badge>
              )}
              {item.errorCode === null ? null : (
                <Badge className="text-[10px]" variant="destructive">
                  {item.errorCode}
                </Badge>
              )}
            </div>
            <CopyButton content={item.content} />
          </div>
          <MessageBlocks blocks={blocks} pending={false} />
        </div>
      </div>
    )
  }

  if (item.type === 'tool_activity') {
    return <ToolRow name={item.name} safeSummary={item.safeSummary} status={item.status} />
  }

  return <CompactionRow summary={item.summary} />
}

function LiveRow({ item }: { item: ChatTimelineItem }) {
  if (item.kind === 'tool') {
    return <ToolRow name={item.name} safeSummary={item.safeSummary} status={item.status} />
  }

  if (item.kind === 'compaction') {
    return <CompactionRow summary={item.summary} />
  }

  const rawText = item.blocks.map((b) => b.text).join('\n\n')

  return (
    <div className="flex items-start gap-3">
      <div className="grid size-8 shrink-0 place-items-center border border-border bg-surface text-primary shadow-sm">
        <Bot aria-hidden="true" size={16} />
      </div>
      <div className="group relative min-w-0 flex-1 border border-border-subtle bg-surface px-4 py-3.5 text-sm leading-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">助手</span>
            {item.completed ? null : (
              <Badge className="animate-pulse text-[10px]" variant="outline">
                生成中
              </Badge>
            )}
          </div>
          {rawText ? <CopyButton content={rawText} /> : null}
        </div>
        <MessageBlocks blocks={item.blocks} pending={!item.completed} />
      </div>
    </div>
  )
}

function PendingAssistantRow() {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-8 shrink-0 place-items-center border border-border bg-surface text-primary shadow-sm">
        <Bot aria-hidden="true" size={16} />
      </div>
      <div className="min-w-0 flex-1 border border-border-subtle bg-surface px-4 py-3.5 text-sm leading-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">助手</span>
          <Badge className="animate-pulse text-[10px]" variant="outline">
            生成中
          </Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">等待模型输出…</p>
      </div>
    </div>
  )
}

/**
 * 消息块渲染：text 块通过 ChatMarkdown 进行排版，thinking 块默认折叠。
 */
function MessageBlocks({ blocks, pending }: { blocks: AgentMessageBlock[]; pending: boolean }) {
  if (blocks.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">{pending ? '等待模型输出…' : '这次没有产生文本内容。'}</p>
  }

  return (
    <div className="mt-2.5 space-y-3">
      {blocks.map((block, index) =>
        block.type === 'thinking' ? (
          <details
            className="group border border-border-subtle bg-surface-muted/60 px-3 py-2.5 text-xs transition-colors open:bg-surface-muted"
            key={index}
          >
            <summary className="flex cursor-pointer select-none items-center justify-between font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <span className="flex items-center gap-1.5">
                <Sparkles aria-hidden="true" size={13} />
                思考过程
              </span>
              <ChevronDown
                aria-hidden="true"
                className="transition-transform duration-200 group-open:rotate-180"
                size={14}
              />
            </summary>
            <p className="mt-2.5 whitespace-pre-wrap leading-5 text-muted-foreground">{block.text}</p>
          </details>
        ) : (
          <ChatMarkdown content={block.text} key={index} />
        ),
      )}
    </div>
  )
}

/** 用户消息携带的图片附件：按原始顺序渲染缩略图，点击放大。 */
function UserMessageImages({ images }: { images: ReadonlyArray<{ attachmentId: string; url: string }> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((image) => (
        <LightboxImage key={image.attachmentId} src={image.url} />
      ))}
    </div>
  )
}

/** 缩略图 + 点击后的全屏预览；点遮罩关闭，点图片本身不关闭。 */
function LightboxImage({ src }: { src: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        aria-label="放大查看图片"
        className="block overflow-hidden rounded border border-border transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={() => setOpen(true)}
        type="button"
      >
        <img alt="图片附件" className="size-20 object-cover" src={src} />
      </button>
      {open ? (
        <div
          aria-label="图片预览"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
        >
          <img
            alt="图片附件"
            className="max-h-full max-w-full object-contain shadow-xl"
            onClick={(event) => event.stopPropagation()}
            src={src}
          />
        </div>
      ) : null}
    </>
  )
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(setCopied, 2000, false)
    } catch {
      // 忽略无法复制的剪贴板异常
    }
  }

  return (
    <button
      aria-label={copied ? '已复制' : '复制消息内容'}
      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      onClick={handleCopy}
      title="复制消息内容"
      type="button"
    >
      {copied ? (
        <>
          <Check aria-hidden="true" className="text-success" size={12} />
          <span className="text-success">已复制</span>
        </>
      ) : (
        <>
          <Copy aria-hidden="true" size={12} />
          <span>复制</span>
        </>
      )}
    </button>
  )
}

function ToolRow({
  name,
  safeSummary,
  status,
}: {
  name: string
  safeSummary: string | null
  status: AgentToolStatus | 'running'
}) {
  const isRunning = status === 'running'
  const isFailed = status === 'failed' || status === 'cancelled' || status === 'timed_out' || status === 'forbidden'

  return (
    <div className="flex items-center justify-between gap-3 border border-border-subtle bg-surface-muted/40 px-3.5 py-2 text-xs shadow-xs">
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Wrench aria-hidden="true" className="shrink-0 text-foreground" size={14} />
        <span className="font-medium text-foreground">{name}</span>
        {safeSummary === null ? null : <span className="truncate text-muted-foreground">— {safeSummary}</span>}
      </div>
      <Badge className="shrink-0 text-[10px]" variant={isRunning ? 'outline' : isFailed ? 'destructive' : 'secondary'}>
        {toolStatusLabels[status]}
      </Badge>
    </div>
  )
}

function CompactionRow({ summary }: { summary: string }) {
  return (
    <div className="border border-border-subtle bg-surface-muted/20 px-3 py-2 text-center text-xs text-muted-foreground">
      较早的对话已压缩：<span className="whitespace-pre-wrap">{summary}</span>
    </div>
  )
}

/** message 和 tool 用协议里的 id 作 key，compaction 用 entryId。 */
function timelineKey(item: ChatTimelineItem): string {
  if (item.kind === 'message') return `message:${item.messageId}`
  if (item.kind === 'tool') return `tool:${item.toolCallId}`
  return `compaction:${item.entryId}`
}
