import type { AgentMessageBlock, AgentToolStatus, AgentTranscriptItem } from '@starter/contracts'
import type { ChatTimelineItem } from '@web/lib/ai/chat-events'

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

const bubbleBase = 'rounded-sm border px-4 py-3 text-sm leading-6'
const userBubble = `${bubbleBase} border-border bg-surface-muted`
const assistantBubble = `${bubbleBase} border-border-subtle bg-surface`
const metaRow = 'flex flex-wrap items-center gap-2 text-xs text-muted-foreground'

const assistantStatusLabels = {
  aborted: '已取消',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
} as const

/**
 * 渲染已持久化的 transcript 历史，再接上当前 Run 的流式视图。
 *
 * 历史来自 `GET /transcript`，流式部分来自本地折叠的 timeline。
 * Run 进终态后调用方会用新的 transcript 替换流式部分，两边不会同时显示同一条消息。
 */
export function ChatTimeline({
  history,
  pendingUserText,
  timeline,
}: {
  history: AgentTranscriptItem[]
  pendingUserText: string | null
  timeline: ChatTimelineItem[]
}) {
  return (
    <div className="grid gap-3">
      {history.map((item) => (
        <TranscriptRow item={item} key={item.id} />
      ))}

      {pendingUserText === null ? null : (
        <div className={userBubble}>
          <p className="text-xs text-muted-foreground">我</p>
          <p className="mt-2 whitespace-pre-wrap">{pendingUserText}</p>
        </div>
      )}

      {timeline.map((item) => (
        <LiveRow item={item} key={timelineKey(item)} />
      ))}
    </div>
  )
}

function TranscriptRow({ item }: { item: AgentTranscriptItem }) {
  if (item.type === 'user_message') {
    return (
      <div className={userBubble}>
        <p className="text-xs text-muted-foreground">我</p>
        <p className="mt-2 whitespace-pre-wrap">{item.content}</p>
      </div>
    )
  }

  if (item.type === 'assistant_message') {
    const blocks: AgentMessageBlock[] = item.blocks ?? [{ text: item.content, type: 'text' }]
    return (
      <div className={assistantBubble}>
        <div className={metaRow}>
          <span>助手</span>
          {item.status === 'completed' ? null : <span>{assistantStatusLabels[item.status]}</span>}
          {item.errorCode === null ? null : <span>{item.errorCode}</span>}
        </div>
        <MessageBlocks blocks={blocks} pending={false} />
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
    <div className={assistantBubble}>
      <div className={metaRow}>
        <span>助手</span>
        {item.completed ? null : <span>生成中</span>}
      </div>
      <MessageBlocks blocks={item.blocks} pending={!item.completed} />
    </div>
  )
}

/**
 * text 块按纯文本渲染并保留换行，thinking 块默认折叠。
 *
 * `pending` 区分两种空块：还在生成时是等待，已结束时是这次确实没有文本。
 * transcript 里失败的 Run 会留下 `blocks: []` 的 assistant 消息，不能再显示成等待中。
 */
function MessageBlocks({ blocks, pending }: { blocks: AgentMessageBlock[]; pending: boolean }) {
  if (blocks.length === 0) {
    return <p className="mt-2 text-muted-foreground">{pending ? '等待模型输出…' : '这次没有产生文本内容。'}</p>
  }

  return (
    <div className="mt-2 grid gap-3">
      {blocks.map((block, index) =>
        block.type === 'thinking' ? (
          <details className="rounded-sm border border-border-subtle bg-surface-muted px-3 py-2" key={index}>
            <summary className="cursor-pointer text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              思考过程
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{block.text}</p>
          </details>
        ) : (
          <p className="whitespace-pre-wrap" key={index}>
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
  return (
    <div className="rounded-sm border border-border-subtle bg-surface-muted px-4 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{name}</span>
      <span className="ml-2">{toolStatusLabels[status]}</span>
      {safeSummary === null ? null : <span className="ml-2 whitespace-pre-wrap">{safeSummary}</span>}
    </div>
  )
}

function CompactionRow({ summary }: { summary: string }) {
  return (
    <div className="rounded-sm border border-border-subtle px-4 py-2 text-xs text-muted-foreground">
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
