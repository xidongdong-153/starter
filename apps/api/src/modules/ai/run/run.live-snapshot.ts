import type {
  AgentMessageBlock,
  AgentRunLiveSnapshot,
  AgentRunLiveTimelineItem,
  AiUsage,
  RunEvent,
} from '@starter/contracts'

/** 时间线元素上限，防止长 Run 的内存无界增长；超限丢最旧的。 */
const MAX_TIMELINE_ITEMS = 128
/** 单条 message 内保留的内容块上限，与契约一致。 */
const MAX_MESSAGE_BLOCKS = 64

type LiveTimelineItem = AgentRunLiveTimelineItem
type LiveMessageItem = Extract<LiveTimelineItem, { kind: 'message' }>
type LiveToolItem = Extract<LiveTimelineItem, { kind: 'tool' }>

type ThinkingBlock = Extract<AgentMessageBlock, { type: 'thinking' }>

interface LiveMessageEntry {
  item: LiveMessageItem
  /** blockIndex（模型流的 contentIndex）到 thinking 块的映射，用于定位续写目标。 */
  thinkingBlocks: Map<number, ThinkingBlock>
}

/**
 * 活跃 Run 的进程内快照状态。
 *
 * 它是流式视图的服务端副本，不是持久事实：Run 进终态后由 Run Service 丢弃，
 * 客户端改从 transcript 读取。产品前端自己折叠事件时按本文件的规则实现，
 * 两侧用 `test-fixtures/run-event-timeline-isomorphism.json` 断言结果同构，
 * 保证刷新页面前后看到的内容一致。
 */
export interface RunLiveSnapshotState {
  lastSequence: number
  turn: number
  maxTurns: number
  timeline: LiveTimelineItem[]
  /** messageId 到时间线里 message 元素的索引，避免每次线性查找。 */
  messages: Map<string, LiveMessageEntry>
}

export function createRunLiveSnapshot(maxTurns: number): RunLiveSnapshotState {
  return {
    lastSequence: 0,
    turn: 0,
    maxTurns,
    timeline: [],
    messages: new Map(),
  }
}

/**
 * 把一个已发布的 RunEvent 折叠进快照。就地更新，不返回新对象。
 *
 * sequence 不递增的事件直接忽略，与前端 reducer 的去重规则一致。
 */
export function applyRunEvent(state: RunLiveSnapshotState, event: RunEvent): void {
  if (event.sequence <= state.lastSequence) return
  state.lastSequence = event.sequence

  switch (event.type) {
    case 'turn.started':
      state.turn = event.turnIndex ?? state.turn
      break
    case 'message.started': {
      if (!event.messageId) break
      const item: LiveMessageItem = {
        kind: 'message',
        messageId: event.messageId,
        blocks: [],
        completed: false,
      }
      pushTimelineItem(state, item)
      state.messages.set(event.messageId, {
        item,
        thinkingBlocks: new Map(),
      })
      break
    }
    case 'message.delta': {
      const entry = event.messageId ? state.messages.get(event.messageId) : undefined
      if (!entry) break
      appendText(entry, event.data.delta)
      break
    }
    case 'thinking.started': {
      const entry = event.messageId ? state.messages.get(event.messageId) : undefined
      if (!entry) break
      thinkingBlock(entry, event.data.blockIndex)
      break
    }
    case 'thinking.delta': {
      const entry = event.messageId ? state.messages.get(event.messageId) : undefined
      if (!entry) break
      const block = thinkingBlock(entry, event.data.blockIndex)
      if (block) block.text += event.data.delta
      break
    }
    case 'thinking.completed': {
      const entry = event.messageId ? state.messages.get(event.messageId) : undefined
      if (!entry) break
      const block = thinkingBlock(entry, event.data.blockIndex)
      // 没有安全摘要时保留 delta 累积出来的正文，不清空已经展示的思考块。
      if (block && event.data.summary !== null) {
        block.text = event.data.summary
      }
      break
    }
    case 'message.completed': {
      const entry = event.messageId ? state.messages.get(event.messageId) : undefined
      if (!entry) break
      completeMessage(entry, event.data.content, event.data.usage ?? null)
      break
    }
    case 'tool.started':
      if (event.toolCallId) {
        upsertTool(state, event.toolCallId, event.data.name).status = 'running'
      }
      break
    case 'tool.progress':
      if (event.toolCallId) {
        upsertTool(state, event.toolCallId, 'tool').safeSummary = event.data.summary
      }
      break
    case 'tool.completed': {
      if (!event.toolCallId) break
      const tool = upsertTool(state, event.toolCallId, event.data.name)
      tool.status = event.data.status
      tool.safeSummary = event.data.summary
      break
    }
    case 'context.compacted':
      pushTimelineItem(state, {
        kind: 'compaction',
        entryId: event.data.entryId,
        summary: event.data.summary,
      })
      break
    default:
      // run.started / turn.completed / terminal 事件不改变快照内容，
      // 只推进 lastSequence。
      break
  }
}

export function toAgentRunLiveSnapshot(state: RunLiveSnapshotState): AgentRunLiveSnapshot {
  return {
    lastSequence: state.lastSequence,
    turn: state.turn,
    maxTurns: state.maxTurns,
    timeline: state.timeline.map((item) =>
      item.kind === 'message' ? { ...item, blocks: item.blocks.map((block) => ({ ...block })) } : { ...item },
    ),
  }
}

/** 文本追加到当前 message 的最后一个 text 块；没有就新建一个。 */
function appendText(entry: LiveMessageEntry, delta: string): void {
  const last = entry.item.blocks.at(-1)
  if (last?.type === 'text') {
    last.text += delta
    return
  }
  pushBlock(entry, { type: 'text', text: delta })
}

/** 按 blockIndex 找 thinking 块；没有就新建。块数撞上限时返回 undefined。 */
function thinkingBlock(entry: LiveMessageEntry, blockIndex: number): ThinkingBlock | undefined {
  const existing = entry.thinkingBlocks.get(blockIndex)
  if (existing) return existing
  const block: ThinkingBlock = { type: 'thinking', text: '' }
  if (!pushBlock(entry, block)) return undefined
  entry.thinkingBlocks.set(blockIndex, block)
  return block
}

/**
 * `message.completed` 收尾：块顺序优先，content 只在能确定归属时作为权威值修正。
 *
 * - 只有一个 text 块：用事件 content 覆盖它，补回可能丢掉的 delta。
 * - 没有 text 块且 content 非空：追加一个 text 块。
 * - 有多个 text 块（interleaved thinking）：保留 delta 累积出来的顺序和内容，
 *   不重排也不折叠，否则终态顺序会和 transcript 投影不一致。
 */
function completeMessage(entry: LiveMessageEntry, content: string, usage: AiUsage | null): void {
  const textBlocks = entry.item.blocks.filter((block) => block.type === 'text')
  if (textBlocks.length === 1 && textBlocks[0]) {
    textBlocks[0].text = content
  } else if (textBlocks.length === 0 && content.length > 0) {
    pushBlock(entry, { type: 'text', text: content })
  }
  entry.item.completed = true
  entry.item.usage = usage
}

function pushBlock(entry: LiveMessageEntry, block: AgentMessageBlock): boolean {
  if (entry.item.blocks.length >= MAX_MESSAGE_BLOCKS) return false
  entry.item.blocks.push(block)
  return true
}

function upsertTool(state: RunLiveSnapshotState, toolCallId: string, name: string): LiveToolItem {
  const existing = state.timeline.find(
    (item): item is LiveToolItem => item.kind === 'tool' && item.toolCallId === toolCallId,
  )
  if (existing) {
    if (name) existing.name = name
    return existing
  }
  const tool: LiveToolItem = {
    kind: 'tool',
    toolCallId,
    name,
    status: 'running',
    safeSummary: null,
  }
  pushTimelineItem(state, tool)
  return tool
}

function pushTimelineItem(state: RunLiveSnapshotState, item: LiveTimelineItem): void {
  state.timeline.push(item)
  while (state.timeline.length > MAX_TIMELINE_ITEMS) {
    const dropped = state.timeline.shift()
    if (dropped?.kind === 'message') state.messages.delete(dropped.messageId)
  }
}
