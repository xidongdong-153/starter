import type { HarnessEvent } from '@starter/contracts'

import type { AgentTimelineItem, TimelineBlock, TimelineMessageItem, TimelineToolItem } from './timeline'

type HarnessMessageStartedEvent = Extract<HarnessEvent, { type: 'message.started' }>
type HarnessMessageDeltaEvent = Extract<HarnessEvent, { type: 'message.delta' }>
type HarnessMessageCompletedEvent = Extract<HarnessEvent, { type: 'message.completed' }>
type HarnessThinkingStartedEvent = Extract<HarnessEvent, { type: 'thinking.started' }>
type HarnessThinkingDeltaEvent = Extract<HarnessEvent, { type: 'thinking.delta' }>
type HarnessThinkingCompletedEvent = Extract<HarnessEvent, { type: 'thinking.completed' }>
type HarnessToolStartedEvent = Extract<HarnessEvent, { type: 'tool.started' }>
type HarnessToolProgressEvent = Extract<HarnessEvent, { type: 'tool.progress' }>
type HarnessToolCompletedEvent = Extract<HarnessEvent, { type: 'tool.completed' }>
type HarnessContextCompactedEvent = Extract<HarnessEvent, { type: 'context.compacted' }>

/** 时间线元素上限，与服务端 `run.live-snapshot.ts` 一致；超限丢最旧的。 */
const MAX_TIMELINE_ITEMS = 128
/** 单条 message 内保留的内容块上限，与契约一致。 */
const MAX_MESSAGE_BLOCKS = 64

export interface HarnessStreamTerminal {
  status: 'completed' | 'failed' | 'aborted'
  finalEntryId: string | null
  errorMessage: string | null
  /** 只有 `run.completed` 带停止原因，其他终态为 null。 */
  reason: 'model_finished' | 'max_turns' | null
}

export interface HarnessStreamState {
  runId: string | null
  /** 同一 Run 内已见过的最大 sequence，用于去重乱序或重放事件 */
  lastSequence: number
  model: { providerId: string; modelId: string } | null
  /** 当前轮次，来自 turn 事件；还没开始第一轮时为 0。 */
  turn: number
  /** 本次 Run 的轮次上限，来自 turn 事件；没收到 turn 事件时为 null。 */
  maxTurns: number | null
  /** 文字、思考、工具和上下文压缩共用的一条时间线，顺序即事件顺序。 */
  timeline: AgentTimelineItem[]
  terminal: HarnessStreamTerminal | null
}

export function createEmptyHarnessStreamState(): HarnessStreamState {
  return {
    runId: null,
    lastSequence: 0,
    model: null,
    turn: 0,
    maxTurns: null,
    timeline: [],
    terminal: null,
  }
}

/** 追加时间线元素，超过上限时丢最旧的，与服务端快照的裁剪规则一致。 */
function pushItem(state: HarnessStreamState, item: AgentTimelineItem): HarnessStreamState {
  const timeline = [...state.timeline, item]
  return { ...state, timeline: timeline.slice(Math.max(0, timeline.length - MAX_TIMELINE_ITEMS)) }
}

function replaceMessage(
  state: HarnessStreamState,
  messageId: string,
  update: (message: TimelineMessageItem) => TimelineMessageItem,
): HarnessStreamState {
  let hit = false
  const timeline = state.timeline.map((item) => {
    if (item.kind !== 'message' || item.messageId !== messageId) return item
    hit = true
    return update(item)
  })
  if (!hit) return state
  return { ...state, timeline }
}

function withBlocks(message: TimelineMessageItem, blocks: TimelineBlock[]): TimelineMessageItem {
  return { ...message, blocks: blocks.slice(0, MAX_MESSAGE_BLOCKS) }
}

function withMessageStarted(state: HarnessStreamState, event: HarnessMessageStartedEvent): HarnessStreamState {
  return pushItem(state, {
    key: event.data.messageId,
    kind: 'message',
    messageId: event.data.messageId,
    blocks: [],
    completed: false,
    usage: null,
    status: null,
    model: state.model,
    errorCode: null,
    createdAt: event.createdAt,
  })
}

/** 文本追加到当前 message 的最后一个 text 块；没有就新建一个。 */
function withMessageDelta(state: HarnessStreamState, event: HarnessMessageDeltaEvent): HarnessStreamState {
  return replaceMessage(state, event.data.messageId, (message) => {
    const last = message.blocks.at(-1)
    if (last?.type === 'text') {
      const blocks = message.blocks.slice(0, -1)
      blocks.push({ type: 'text', text: last.text + event.data.delta })
      return withBlocks(message, blocks)
    }
    return withBlocks(message, [...message.blocks, { type: 'text', text: event.data.delta }])
  })
}

/**
 * `message.completed` 收尾：块顺序优先，content 只在能确定归属时作为权威值修正。
 * 只有一个 text 块时用 content 覆盖；没有 text 块且 content 非空时追加；
 * 有多个 text 块（interleaved thinking）时保留原顺序和原内容，不重排也不折叠。
 * 规则与服务端 `run.live-snapshot.ts` 同构。
 */
function withMessageCompleted(state: HarnessStreamState, event: HarnessMessageCompletedEvent): HarnessStreamState {
  return replaceMessage(state, event.data.messageId, (message) => {
    const textCount = message.blocks.filter((block) => block.type === 'text').length
    let blocks = message.blocks
    if (textCount === 1) {
      blocks = message.blocks.map((block) =>
        block.type === 'text' ? { type: 'text', text: event.data.content } : block,
      )
    } else if (textCount === 0 && event.data.content.length > 0) {
      blocks = [...message.blocks, { type: 'text', text: event.data.content }]
    }
    return {
      ...withBlocks(message, blocks),
      completed: true,
      usage: event.data.usage ?? null,
      errorCode: event.data.errorCode,
    }
  })
}

/** 按 blockIndex 定位 thinking 块；没有就新建。块数撞上限时保持原样。 */
function withThinkingBlock(
  state: HarnessStreamState,
  event: HarnessThinkingStartedEvent | HarnessThinkingDeltaEvent | HarnessThinkingCompletedEvent,
  update: (current: string) => string,
): HarnessStreamState {
  return replaceMessage(state, event.data.messageId, (message) => {
    const index = message.blocks.findIndex(
      (block) => block.type === 'thinking' && block.blockIndex === event.data.blockIndex,
    )
    if (index === -1) {
      return withBlocks(message, [
        ...message.blocks,
        { type: 'thinking', text: update(''), blockIndex: event.data.blockIndex },
      ])
    }
    const blocks = message.blocks.map((block, position) =>
      position === index && block.type === 'thinking' ? { ...block, text: update(block.text) } : block,
    )
    return withBlocks(message, blocks)
  })
}

function upsertTool(
  state: HarnessStreamState,
  event: HarnessToolStartedEvent | HarnessToolProgressEvent | HarnessToolCompletedEvent,
  update: (tool: TimelineToolItem) => TimelineToolItem,
): HarnessStreamState {
  const existing = state.timeline.find(
    (item): item is TimelineToolItem => item.kind === 'tool' && item.toolCallId === event.data.toolCallId,
  )
  if (existing) {
    const updated = update({ ...existing, name: event.data.name || existing.name })
    return {
      ...state,
      timeline: state.timeline.map((item) => (item.key === updated.key ? updated : item)),
    }
  }
  return pushItem(
    state,
    update({
      key: `tool:${event.data.toolCallId}`,
      kind: 'tool',
      toolCallId: event.data.toolCallId,
      name: event.data.name,
      status: 'running',
      safeSummary: null,
      errorCode: null,
      createdAt: event.createdAt,
    }),
  )
}

function withContextCompacted(state: HarnessStreamState, event: HarnessContextCompactedEvent): HarnessStreamState {
  return pushItem(state, {
    key: `compaction:${event.data.entryId}`,
    kind: 'compaction',
    entryId: event.data.entryId,
    summary: event.data.summary,
    tokensBefore: event.data.tokensBefore,
    createdAt: event.createdAt,
  })
}

/**
 * 按 `runId + sequence` 去重后把 HarnessEvent 应用到流式视图。
 * 文字、思考、工具和 compaction 落到同一条时间线，顺序即 sequence 顺序。
 * 折叠规则与服务端 `apps/api/src/modules/ai/run/run.live-snapshot.ts` 同构。
 * 第一个 terminal event 固定终态，之后的终态事件忽略。
 * 事件属于其他 Run 时忽略，不污染当前视图。
 * 返回不可变更新后的状态；未命中时返回原状态引用。
 */
export function reduceHarnessEvent(state: HarnessStreamState, event: HarnessEvent): HarnessStreamState {
  if (state.runId !== null && state.runId !== event.runId) return state
  if (event.sequence <= state.lastSequence) return state

  let runId = state.runId
  if (runId === null) runId = event.runId
  const base: HarnessStreamState = { ...state, runId, lastSequence: event.sequence }

  switch (event.type) {
    case 'run.started':
      return { ...base, model: event.data.model }
    case 'turn.started':
      return { ...base, turn: event.data.turn, maxTurns: event.data.maxTurns }
    case 'turn.completed':
      return { ...base, turn: event.data.turn, maxTurns: event.data.maxTurns }
    case 'message.started':
      return withMessageStarted(base, event)
    case 'message.delta':
      return withMessageDelta(base, event)
    case 'message.completed':
      return withMessageCompleted(base, event)
    case 'thinking.started':
      return withThinkingBlock(base, event, (current) => current)
    case 'thinking.delta':
      return withThinkingBlock(base, event, (current) => current + event.data.delta)
    case 'thinking.completed':
      return withThinkingBlock(base, event, () => event.data.content)
    case 'tool.started':
      return upsertTool(base, event, (tool) => ({ ...tool, status: 'running', name: event.data.name }))
    case 'tool.progress':
      return upsertTool(base, event, (tool) => ({ ...tool, safeSummary: event.data.safeSummary }))
    case 'tool.completed':
      return upsertTool(base, event, (tool) => ({
        ...tool,
        status: event.data.status,
        errorCode: event.data.errorCode,
        safeSummary: event.data.safeSummary,
      }))
    case 'context.compacted':
      return withContextCompacted(base, event)
    case 'run.completed':
      if (base.terminal) return base
      return {
        ...base,
        terminal: {
          status: 'completed',
          finalEntryId: event.data.finalEntryId,
          errorMessage: null,
          reason: event.data.reason,
        },
      }
    case 'run.failed':
      if (base.terminal) return base
      return {
        ...base,
        terminal: {
          status: 'failed',
          finalEntryId: event.data.finalEntryId,
          errorMessage: event.data.error.message,
          reason: null,
        },
      }
    case 'run.aborted':
      if (base.terminal) return base
      return {
        ...base,
        terminal: { status: 'aborted', finalEntryId: event.data.finalEntryId, errorMessage: null, reason: null },
      }
    default:
      return base
  }
}
