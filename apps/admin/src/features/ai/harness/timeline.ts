import type {
  AgentRunLiveSnapshot,
  AgentToolStatus,
  AgentTranscriptItem,
  AiModelRef,
  AiUsage,
} from '@starter/contracts'

/**
 * assistant message 内部的有序内容块。
 * 与 contracts 的 `AgentMessageBlock` 同构，thinking 块多带一个 `blockIndex`：
 * 流式事件按 blockIndex 定位续写目标，transcript 和 live 快照没有这个信息，为 null。
 */
export type TimelineBlock =
  { type: 'text'; text: string } | { type: 'thinking'; text: string; blockIndex: number | null }

export interface TimelineUserItem {
  key: string
  kind: 'user'
  content: string
  createdAt: string | null
}

export interface TimelineMessageItem {
  key: string
  kind: 'message'
  messageId: string
  blocks: TimelineBlock[]
  completed: boolean
  usage: AiUsage | null
  /** transcript 侧的持久状态；流式侧没有，为 null。 */
  status: 'completed' | 'failed' | 'aborted' | 'interrupted' | null
  model: AiModelRef | null
  errorCode: string | null
  createdAt: string | null
}

export interface TimelineToolItem {
  key: string
  kind: 'tool'
  toolCallId: string
  name: string
  status: AgentToolStatus | 'running'
  safeSummary: string | null
  errorCode: string | null
  createdAt: string | null
}

export interface TimelineCompactionItem {
  key: string
  kind: 'compaction'
  entryId: string
  summary: string
  tokensBefore: number | null
  createdAt: string | null
}

/** 流式视图和历史视图共用的时间线元素。两种数据源都转成这一种类型再渲染。 */
export type AgentTimelineItem = TimelineUserItem | TimelineMessageItem | TimelineToolItem | TimelineCompactionItem

/** 把 `GET /runs/{runId}` 的 live 快照转成时间线元素。 */
export function fromLiveSnapshot(live: AgentRunLiveSnapshot): AgentTimelineItem[] {
  return live.timeline.map((item) => {
    if (item.kind === 'message') {
      return {
        key: item.messageId,
        kind: 'message',
        messageId: item.messageId,
        blocks: item.blocks.map((block) =>
          block.type === 'thinking'
            ? { type: 'thinking', text: block.text, blockIndex: null }
            : { type: 'text', text: block.text },
        ),
        completed: item.completed,
        usage: item.usage ?? null,
        status: null,
        model: null,
        errorCode: null,
        createdAt: null,
      } satisfies TimelineMessageItem
    }
    if (item.kind === 'tool') {
      return {
        key: `tool:${item.toolCallId}`,
        kind: 'tool',
        toolCallId: item.toolCallId,
        name: item.name,
        status: item.status,
        safeSummary: item.safeSummary,
        errorCode: null,
        createdAt: null,
      } satisfies TimelineToolItem
    }
    return {
      key: `compaction:${item.entryId}`,
      kind: 'compaction',
      entryId: item.entryId,
      summary: item.summary,
      tokensBefore: null,
      createdAt: null,
    } satisfies TimelineCompactionItem
  })
}

/** 把 transcript 的 items 转成时间线元素，顺序沿用服务端返回的时间正序。 */
export function fromTranscript(items: AgentTranscriptItem[]): AgentTimelineItem[] {
  return items.map((item) => {
    if (item.type === 'user_message') {
      return {
        key: item.id,
        kind: 'user',
        content: item.content,
        createdAt: item.createdAt,
      } satisfies TimelineUserItem
    }
    if (item.type === 'assistant_message') {
      return {
        key: item.id,
        kind: 'message',
        messageId: item.id,
        blocks: transcriptBlocks(item),
        completed: true,
        usage: item.usage ?? null,
        status: item.status,
        model: item.model,
        errorCode: item.errorCode,
        createdAt: item.createdAt,
      } satisfies TimelineMessageItem
    }
    if (item.type === 'tool_activity') {
      return {
        key: item.id,
        kind: 'tool',
        toolCallId: item.toolCallId,
        name: item.name,
        status: item.status,
        safeSummary: item.safeSummary,
        errorCode: item.errorCode,
        createdAt: item.createdAt,
      } satisfies TimelineToolItem
    }
    return {
      key: item.id,
      kind: 'compaction',
      entryId: item.id,
      summary: item.summary,
      tokensBefore: item.tokensBefore ?? null,
      createdAt: item.createdAt,
    } satisfies TimelineCompactionItem
  })
}

/** assistant item 优先用 `blocks`；服务端没给 blocks 时退回 `content` 生成单个 text 块。 */
function transcriptBlocks(item: Extract<AgentTranscriptItem, { type: 'assistant_message' }>): TimelineBlock[] {
  if (item.blocks && item.blocks.length > 0) {
    return item.blocks.map((block) =>
      block.type === 'thinking'
        ? { type: 'thinking', text: block.text, blockIndex: null }
        : { type: 'text', text: block.text },
    )
  }
  return item.content.length > 0 ? [{ type: 'text', text: item.content }] : []
}
