'use client'

import type { AgentMessageBlock, AgentToolStatus, AgentTranscriptItem } from '@starter/contracts'
import { Bot, ChevronDown, Sparkles, User, Wrench } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Badge } from '@web/components/ui/badge'
import type { ChatTimelineItem } from '@web/lib/ai/chat-events'
import { cn } from '@web/lib/utils'

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

export interface ChatTimelineProps {
  history: AgentTranscriptItem[]
  pendingUserText: string | null
  timeline: ChatTimelineItem[]
  className?: string
}

/**
 * 渲染已持久化的 transcript 历史，再接上当前 Run 的流式视图。
 * 容器具备内部独立滚动，并在新消息到来或流式输出时直接滚动容器本身，避免页面全局滚动。
 */
export function ChatTimeline({ history, pendingUserText, timeline, className }: ChatTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isAutoScrollActiveRef = useRef(true)

  const empty = history.length === 0 && pendingUserText === null && timeline.length === 0

  // 监听容器内部滚动，当用户主动向上翻阅历史时暂停自动触底
  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 80
    isAutoScrollActiveRef.current = isNearBottom
  }

  // 依赖内容更新直接滚动内部容器，绝不调用会导致祖先窗口滚动的 scrollIntoView
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
    <div
      aria-label="对话消息流"
      className={cn('flex-1 overflow-y-auto p-4 md:p-6', className)}
      onScroll={handleScroll}
      ref={containerRef}
    >
      {empty ? (
        <div className="flex h-full min-h-[300px] flex-col items-center justify-center p-8 text-center">
          <div className="grid size-12 place-items-center border border-border bg-surface-muted/60 text-primary shadow-sm">
            <Sparkles aria-hidden="true" size={24} />
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">开始与 Agent 对话</h3>
          <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
            在下方输入框中键入你的提问或任务，支持 Enter 发送，Shift + Enter 换行。
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          {history.map((item) => (
            <TranscriptRow item={item} key={item.id} />
          ))}

          {pendingUserText === null ? null : (
            <div className="flex items-start justify-end gap-3">
              <div className="max-w-[85%] border border-border bg-surface-muted px-4 py-3 text-sm leading-6 shadow-sm">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <User aria-hidden="true" size={13} />
                  <span>我</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-foreground">{pendingUserText}</p>
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
  )
}

function TranscriptRow({ item }: { item: AgentTranscriptItem }) {
  if (item.type === 'user_message') {
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="max-w-[85%] border border-border bg-surface-muted px-4 py-3 text-sm leading-6 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User aria-hidden="true" size={13} />
            <span>我</span>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-foreground">{item.content}</p>
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
        <div className="min-w-0 flex-1 border border-border-subtle bg-surface px-4 py-3.5 text-sm leading-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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

  return (
    <div className="flex items-start gap-3">
      <div className="grid size-8 shrink-0 place-items-center border border-border bg-surface text-primary shadow-sm">
        <Bot aria-hidden="true" size={16} />
      </div>
      <div className="min-w-0 flex-1 border border-border-subtle bg-surface px-4 py-3.5 text-sm leading-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">助手</span>
          {item.completed ? null : (
            <Badge className="animate-pulse text-[10px]" variant="outline">
              生成中
            </Badge>
          )}
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
 * text 块按纯文本渲染并保留换行，thinking 块默认折叠。
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
          <p className="whitespace-pre-wrap text-foreground" key={index}>
            {block.text}
          </p>
        ),
      )}
    </div>
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
