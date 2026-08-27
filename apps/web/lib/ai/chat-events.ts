import type {
  AgentMessageBlock,
  AgentRunLiveSnapshot,
  AgentRunLiveTimelineItem,
  AgentRunStatus,
  AiUsage,
  ApiErrorCode,
  RunEvent,
} from '@starter/contracts'

const MAX_TIMELINE_ITEMS = 128
const MAX_MESSAGE_BLOCKS = 64
export type ChatTimelineItem = AgentRunLiveTimelineItem
export type ChatMessageItem = Extract<ChatTimelineItem, { kind: 'message' }>
export type ChatToolItem = Extract<ChatTimelineItem, { kind: 'tool' }>
type ThinkingBlock = Extract<AgentMessageBlock, { type: 'thinking' }>

export interface ChatRunState {
  lastSequence: number
  turn: number
  maxTurns: number
  timeline: ChatTimelineItem[]
  status: AgentRunStatus
  errorCode: ApiErrorCode | null
  errorMessage: string | null
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

export function applyRunEvent(state: ChatRunState, event: RunEvent): ChatRunState {
  if (event.sequence <= state.lastSequence) return state
  const next = { ...state, lastSequence: event.sequence }
  switch (event.type) {
    case 'run.started':
      return { ...next, status: 'running' }
    case 'turn.started':
      return { ...next, turn: event.turnIndex ?? 0 }
    case 'message.started':
      return pushTimelineItem(next, { kind: 'message', messageId: event.messageId ?? '', blocks: [], completed: false })
    case 'message.delta':
      return updateMessage(next, event.messageId, (draft) => appendText(draft, event.data.delta))
    case 'thinking.started':
      return updateMessage(next, event.messageId, (draft) => {
        thinkingBlock(draft, event.data.blockIndex)
      })
    case 'thinking.delta':
      return updateMessage(next, event.messageId, (draft) => {
        const block = thinkingBlock(draft, event.data.blockIndex)
        if (block) block.text += event.data.delta
      })
    case 'thinking.completed':
      return updateMessage(next, event.messageId, (draft) => {
        thinkingBlock(draft, event.data.blockIndex)
      })
    case 'message.completed':
      return updateMessage(next, event.messageId, (draft) =>
        completeMessage(draft, event.data.content, event.data.usage ?? null),
      )
    case 'tool.started':
      return upsertTool(next, event.toolCallId ?? '', event.data.name, (tool) => {
        tool.status = 'running'
      })
    case 'tool.progress':
      return upsertTool(next, event.toolCallId ?? '', '', (tool) => {
        tool.safeSummary = event.data.summary
      })
    case 'tool.completed':
      return upsertTool(next, event.toolCallId ?? '', event.data.name, (tool) => {
        tool.status = event.data.status
        tool.safeSummary = event.data.summary
      })
    case 'context.compacted':
      return pushTimelineItem(next, { kind: 'compaction', entryId: event.data.entryId, summary: event.data.summary })
    case 'run.completed':
      return { ...next, status: 'completed', errorCode: null, errorMessage: null }
    case 'run.failed':
      return { ...next, status: 'failed', errorCode: event.data.error.code, errorMessage: null }
    case 'run.aborted':
      return { ...next, status: 'aborted', errorCode: 'AI.REQUEST_ABORTED', errorMessage: null }
    default:
      return next
  }
}

export function toLiveSnapshot(state: ChatRunState): AgentRunLiveSnapshot {
  return {
    lastSequence: state.lastSequence,
    turn: state.turn,
    maxTurns: state.maxTurns,
    timeline: state.timeline.map(cloneTimelineItem),
  }
}

interface MessageDraft {
  item: ChatMessageItem
  thinking: Map<number, number>
}
function updateMessage(
  state: ChatRunState,
  messageId: string | null,
  update: (draft: MessageDraft) => void,
): ChatRunState {
  if (!messageId) return state
  const index = state.timeline.findIndex((item) => item.kind === 'message' && item.messageId === messageId)
  const found = index < 0 ? undefined : state.timeline[index]
  if (!found || found.kind !== 'message') return state
  const draft = {
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
function appendText(draft: MessageDraft, delta: string): void {
  const last = draft.item.blocks.at(-1)
  if (last?.type === 'text') last.text += delta
  else pushBlock(draft, { type: 'text', text: delta })
}
function thinkingBlock(draft: MessageDraft, blockIndex: number): ThinkingBlock | undefined {
  const position = draft.thinking.get(blockIndex)
  const existing = position === undefined ? undefined : draft.item.blocks[position]
  if (existing?.type === 'thinking') return existing
  const block: ThinkingBlock = { type: 'thinking', text: '' }
  if (!pushBlock(draft, block)) return undefined
  draft.thinking.set(blockIndex, draft.item.blocks.length - 1)
  return block
}
function completeMessage(draft: MessageDraft, content: string, usage: AiUsage | null): void {
  const textBlocks = draft.item.blocks.filter((block) => block.type === 'text')
  if (textBlocks.length === 1 && textBlocks[0]) textBlocks[0].text = content
  else if (textBlocks.length === 0 && content) pushBlock(draft, { type: 'text', text: content })
  draft.item.completed = true
  draft.item.usage = usage
}
function pushBlock(draft: MessageDraft, block: AgentMessageBlock): boolean {
  if (draft.item.blocks.length >= MAX_MESSAGE_BLOCKS) return false
  draft.item.blocks.push(block)
  return true
}
function upsertTool(
  state: ChatRunState,
  toolCallId: string,
  name: string,
  update: (tool: ChatToolItem) => void,
): ChatRunState {
  const index = state.timeline.findIndex((item) => item.kind === 'tool' && item.toolCallId === toolCallId)
  const found = index < 0 ? undefined : state.timeline[index]
  if (found?.kind === 'tool') {
    const tool = { ...found }
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
  return item.kind === 'message' ? { ...item, blocks: item.blocks.map((block) => ({ ...block })) } : { ...item }
}
