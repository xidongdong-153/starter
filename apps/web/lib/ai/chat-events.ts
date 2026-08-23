import type {
  AgentMessageBlock,
  AgentRunLiveSnapshot,
  AgentRunLiveTimelineItem,
  AgentRunStatus,
  AiUsage,
  ApiErrorCode,
  HarnessEvent,
} from '@starter/contracts'

/** 时间线元素上限，超限丢最旧的，与 API live 快照一致。 */
const MAX_TIMELINE_ITEMS = 128
/** 单条 message 内保留的内容块上限，撞上限后不再追加新块。 */
const MAX_MESSAGE_BLOCKS = 64

/** 时间线元素与 `agentRunLiveSnapshotSchema` 的 timeline 同构，可以直接和 API 快照比对。 */
export type ChatTimelineItem = AgentRunLiveTimelineItem
export type ChatMessageItem = Extract<ChatTimelineItem, { kind: 'message' }>
export type ChatToolItem = Extract<ChatTimelineItem, { kind: 'tool' }>

type ThinkingBlock = Extract<AgentMessageBlock, { type: 'thinking' }>

/**
 * Chat 页面的 Run 视图状态。
 *
 * 折叠规则与 `apps/api/src/modules/ai/run/run.live-snapshot.ts` 一致，
 * 用 `test-fixtures/harness-timeline-isomorphism.json` 校验两侧结果同构。
 * 和 API 实现的差别有两处：这里返回新对象而不是就地更新，让 React 能拿到新引用；
 * 另外多了 `status`、`errorCode` 和 `errorMessage`，用来控制输入框和错误提示，它们不进时间线。
 */
export interface ChatRunState {
  lastSequence: number
  turn: number
  maxTurns: number
  timeline: ChatTimelineItem[]
  status: AgentRunStatus
  errorCode: ApiErrorCode | null
  /** `run.failed` 带的可读说明，只有事件流能拿到；轮询 Run 状态时只有 errorCode。 */
  errorMessage: string | null
  /** messageId 到「blockIndex - blocks 下标」的映射，用于定位续写中的 thinking 块。 */
  thinkingBlocks: Map<string, Map<number, number>>
}

export function createChatRunState(maxTurns = 1): ChatRunState {
  return {
    lastSequence: 0,
    turn: 0,
    maxTurns,
    timeline: [],
    status: 'starting',
    errorCode: null,
    errorMessage: null,
    thinkingBlocks: new Map(),
  }
}

/**
 * 把一个 HarnessEvent 折叠进状态，返回新对象。
 *
 * sequence 不递增的事件直接丢弃，重连后重复推送的事件不会重复累加。
 */
export function applyHarnessEvent(state: ChatRunState, event: HarnessEvent): ChatRunState {
  if (event.sequence <= state.lastSequence) return state
  const next: ChatRunState = { ...state, lastSequence: event.sequence }

  switch (event.type) {
    case 'run.started':
      return { ...next, status: 'running' }
    case 'turn.started':
      // Web 启动 Run 时拿不到 Run snapshot，maxTurns 从事件补齐；值和 snapshot 里的一致。
      return { ...next, turn: event.data.turn, maxTurns: event.data.maxTurns }
    case 'message.started':
      return pushTimelineItem(next, {
        kind: 'message',
        messageId: event.data.messageId,
        blocks: [],
        completed: false,
      })
    case 'message.delta':
      return updateMessage(next, event.data.messageId, (draft) => {
        appendText(draft, event.data.delta)
      })
    case 'thinking.started':
      return updateMessage(next, event.data.messageId, (draft) => {
        thinkingBlock(draft, event.data.blockIndex)
      })
    case 'thinking.delta':
      return updateMessage(next, event.data.messageId, (draft) => {
        const block = thinkingBlock(draft, event.data.blockIndex)
        if (block) block.text += event.data.delta
      })
    case 'thinking.completed':
      return updateMessage(next, event.data.messageId, (draft) => {
        const block = thinkingBlock(draft, event.data.blockIndex)
        if (block) block.text = event.data.content
      })
    case 'message.completed':
      return updateMessage(next, event.data.messageId, (draft) => {
        completeMessage(draft, event.data.content, event.data.usage ?? null)
      })
    case 'tool.started':
      return upsertTool(next, event.data.toolCallId, event.data.name, (tool) => {
        tool.status = 'running'
      })
    case 'tool.progress':
      return upsertTool(next, event.data.toolCallId, event.data.name, (tool) => {
        tool.safeSummary = event.data.safeSummary
      })
    case 'tool.completed':
      return upsertTool(next, event.data.toolCallId, event.data.name, (tool) => {
        tool.status = event.data.status
        tool.safeSummary = event.data.safeSummary
      })
    case 'context.compacted':
      return pushTimelineItem(next, {
        kind: 'compaction',
        entryId: event.data.entryId,
        summary: event.data.summary,
      })
    case 'run.completed':
      return { ...next, status: 'completed', errorCode: null, errorMessage: null }
    case 'run.failed':
      return { ...next, status: 'failed', errorCode: event.data.error.code, errorMessage: event.data.error.message }
    case 'run.aborted':
      return { ...next, status: 'aborted', errorCode: event.data.errorCode, errorMessage: null }
    default:
      // turn.completed 不改变展示内容，只推进 lastSequence。
      return next
  }
}

/** 投影成 API live 快照的形状，用于和 API 结果比对，或被 API 快照覆盖后重建视图。 */
export function toLiveSnapshot(state: ChatRunState): AgentRunLiveSnapshot {
  return {
    lastSequence: state.lastSequence,
    turn: state.turn,
    maxTurns: state.maxTurns,
    timeline: state.timeline.map((item) => cloneTimelineItem(item)),
  }
}

interface MessageDraft {
  item: ChatMessageItem
  /** 当前 message 的 blockIndex 到 blocks 下标映射。 */
  thinking: Map<number, number>
}

/**
 * 定位 message 元素，复制后交给 update 修改，再写回新的 timeline。
 *
 * 找不到对应 message 时只保留已推进的 lastSequence，不新建元素。
 */
function updateMessage(state: ChatRunState, messageId: string, update: (draft: MessageDraft) => void): ChatRunState {
  const index = state.timeline.findIndex((item) => item.kind === 'message' && item.messageId === messageId)
  const found = index === -1 ? undefined : state.timeline[index]
  if (!found || found.kind !== 'message') return state

  const draft: MessageDraft = {
    item: { ...found, blocks: found.blocks.map((block) => ({ ...block })) },
    thinking: new Map(state.thinkingBlocks.get(messageId) ?? []),
  }
  update(draft)

  const timeline = [...state.timeline]
  timeline[index] = draft.item
  const thinkingBlocks = new Map(state.thinkingBlocks)
  thinkingBlocks.set(messageId, draft.thinking)
  return { ...state, timeline, thinkingBlocks }
}

/** 文本追加到最后一个 text 块；最后一个块不是 text 就新建一个。 */
function appendText(draft: MessageDraft, delta: string): void {
  const last = draft.item.blocks.at(-1)
  if (last?.type === 'text') {
    last.text += delta
    return
  }
  pushBlock(draft, { type: 'text', text: delta })
}

/** 按 blockIndex 找 thinking 块；没有就新建。块数撞上限时返回 undefined。 */
function thinkingBlock(draft: MessageDraft, blockIndex: number): ThinkingBlock | undefined {
  const position = draft.thinking.get(blockIndex)
  const existing = position === undefined ? undefined : draft.item.blocks[position]
  if (existing?.type === 'thinking') return existing

  const block: ThinkingBlock = { type: 'thinking', text: '' }
  if (!pushBlock(draft, block)) return undefined
  draft.thinking.set(blockIndex, draft.item.blocks.length - 1)
  return block
}

/**
 * `message.completed` 收尾：块顺序优先，content 只在能确定归属时作为权威值修正。
 *
 * - 只有一个 text 块：用事件 content 覆盖它，补回可能丢掉的 delta。
 * - 没有 text 块且 content 非空：追加一个 text 块。
 * - 有多个 text 块（中间夹着 thinking）：保留 delta 累积出来的顺序和内容，不重排也不合并，
 *   否则终态视图会和 transcript 投影不一致。
 */
function completeMessage(draft: MessageDraft, content: string, usage: AiUsage | null): void {
  const textBlocks = draft.item.blocks.filter((block) => block.type === 'text')
  if (textBlocks.length === 1 && textBlocks[0]) {
    textBlocks[0].text = content
  } else if (textBlocks.length === 0 && content.length > 0) {
    pushBlock(draft, { type: 'text', text: content })
  }
  draft.item.completed = true
  draft.item.usage = usage
}

function pushBlock(draft: MessageDraft, block: AgentMessageBlock): boolean {
  if (draft.item.blocks.length >= MAX_MESSAGE_BLOCKS) return false
  draft.item.blocks.push(block)
  return true
}

/** 按 toolCallId 定位同一个 tool 元素；没有就新建并追加到时间线末尾。 */
function upsertTool(
  state: ChatRunState,
  toolCallId: string,
  name: string,
  update: (tool: ChatToolItem) => void,
): ChatRunState {
  const index = state.timeline.findIndex((item) => item.kind === 'tool' && item.toolCallId === toolCallId)
  const found = index === -1 ? undefined : state.timeline[index]

  if (found?.kind === 'tool') {
    const tool: ChatToolItem = { ...found }
    if (name) tool.name = name
    update(tool)
    const timeline = [...state.timeline]
    timeline[index] = tool
    return { ...state, timeline }
  }

  const tool: ChatToolItem = { kind: 'tool', toolCallId, name, status: 'running', safeSummary: null }
  update(tool)
  return pushTimelineItem(state, tool)
}

function pushTimelineItem(state: ChatRunState, item: ChatTimelineItem): ChatRunState {
  const timeline = [...state.timeline, item]
  const thinkingBlocks = new Map(state.thinkingBlocks)
  while (timeline.length > MAX_TIMELINE_ITEMS) {
    const dropped = timeline.shift()
    if (dropped?.kind === 'message') thinkingBlocks.delete(dropped.messageId)
  }
  return { ...state, timeline, thinkingBlocks }
}

function cloneTimelineItem(item: ChatTimelineItem): ChatTimelineItem {
  if (item.kind !== 'message') return { ...item }
  return { ...item, blocks: item.blocks.map((block) => ({ ...block })) }
}
