import type { AgentToolStatus, HarnessEvent } from '@starter/contracts'

type HarnessMessageStartedEvent = Extract<HarnessEvent, { type: 'message.started' }>
type HarnessMessageDeltaEvent = Extract<HarnessEvent, { type: 'message.delta' }>
type HarnessMessageCompletedEvent = Extract<HarnessEvent, { type: 'message.completed' }>
type HarnessToolStartedEvent = Extract<HarnessEvent, { type: 'tool.started' }>
type HarnessToolProgressEvent = Extract<HarnessEvent, { type: 'tool.progress' }>
type HarnessToolCompletedEvent = Extract<HarnessEvent, { type: 'tool.completed' }>

export interface HarnessStreamMessage {
  messageId: string
  role: 'assistant'
  content: string
  completed: boolean
  stopReason: 'stop' | 'length' | 'tool_use' | null
  errorCode: string | null
}

export interface HarnessStreamTool {
  toolCallId: string
  name: string
  status: AgentToolStatus | 'running'
  safeSummary: string | null
  errorCode: string | null
}

export interface HarnessStreamTerminal {
  status: 'completed' | 'failed' | 'aborted'
  finalEntryId: string | null
  errorMessage: string | null
}

export interface HarnessStreamState {
  runId: string | null
  /** 同一 Run 内已见过的最大 sequence，用于去重乱序或重放事件 */
  lastSequence: number
  model: { providerId: string; modelId: string } | null
  messages: HarnessStreamMessage[]
  tools: HarnessStreamTool[]
  terminal: HarnessStreamTerminal | null
}

export function createEmptyHarnessStreamState(): HarnessStreamState {
  return {
    runId: null,
    lastSequence: 0,
    model: null,
    messages: [],
    tools: [],
    terminal: null,
  }
}

function withMessageStarted(state: HarnessStreamState, event: HarnessMessageStartedEvent): HarnessStreamState {
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        messageId: event.data.messageId,
        role: 'assistant',
        content: '',
        completed: false,
        stopReason: null,
        errorCode: null,
      },
    ],
  }
}

function withMessageDelta(state: HarnessStreamState, event: HarnessMessageDeltaEvent): HarnessStreamState {
  const next = state.messages.map((message) =>
    message.messageId === event.data.messageId ? { ...message, content: message.content + event.data.delta } : message,
  )
  if (
    next.length === state.messages.length &&
    !state.messages.some((item) => item.messageId === event.data.messageId)
  ) {
    return state
  }
  return { ...state, messages: next }
}

function withMessageCompleted(state: HarnessStreamState, event: HarnessMessageCompletedEvent): HarnessStreamState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.messageId === event.data.messageId
        ? {
            ...message,
            content: event.data.content,
            completed: true,
            stopReason: event.data.stopReason,
            errorCode: event.data.errorCode,
          }
        : message,
    ),
  }
}

function upsertTool(
  state: HarnessStreamState,
  event: HarnessToolStartedEvent | HarnessToolCompletedEvent | HarnessToolProgressEvent,
): { state: HarnessStreamState; tool: HarnessStreamTool } {
  const existing = state.tools.find((item) => item.toolCallId === event.data.toolCallId)
  if (existing) {
    return { state, tool: { ...existing, name: event.data.name || existing.name } }
  }
  const tool: HarnessStreamTool = {
    toolCallId: event.data.toolCallId,
    name: event.data.name,
    status: 'running' as const,
    safeSummary: null,
    errorCode: null,
  }
  return { state: { ...state, tools: [...state.tools, tool] }, tool }
}

function withToolStarted(state: HarnessStreamState, event: HarnessToolStartedEvent): HarnessStreamState {
  const result = upsertTool(state, event)
  const updated: HarnessStreamTool = { ...result.tool, status: 'running', name: event.data.name }
  return {
    ...result.state,
    tools: result.state.tools.map((item) => (item.toolCallId === updated.toolCallId ? updated : item)),
  }
}

function withToolProgress(state: HarnessStreamState, event: HarnessToolProgressEvent): HarnessStreamState {
  const result = upsertTool(state, event)
  const updated: HarnessStreamTool = { ...result.tool, safeSummary: event.data.safeSummary }
  return {
    ...result.state,
    tools: result.state.tools.map((item) => (item.toolCallId === updated.toolCallId ? updated : item)),
  }
}

function withToolCompleted(state: HarnessStreamState, event: HarnessToolCompletedEvent): HarnessStreamState {
  const result = upsertTool(state, event)
  const updated: HarnessStreamTool = {
    ...result.tool,
    status: event.data.status,
    errorCode: event.data.errorCode,
    safeSummary: event.data.safeSummary,
  }
  return {
    ...result.state,
    tools: result.state.tools.map((item) => (item.toolCallId === updated.toolCallId ? updated : item)),
  }
}

/**
 * 按 `runId + sequence` 去重后把 HarnessEvent 应用到流式视图。
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
    case 'message.started':
      return withMessageStarted(base, event)
    case 'message.delta':
      return withMessageDelta(base, event)
    case 'message.completed':
      return withMessageCompleted(base, event)
    case 'tool.started':
      return withToolStarted(base, event)
    case 'tool.progress':
      return withToolProgress(base, event)
    case 'tool.completed':
      return withToolCompleted(base, event)
    case 'run.completed':
      if (base.terminal) return base
      return {
        ...base,
        terminal: { status: 'completed', finalEntryId: event.data.finalEntryId, errorMessage: null },
      }
    case 'run.failed':
      if (base.terminal) return base
      return {
        ...base,
        terminal: {
          status: 'failed',
          finalEntryId: event.data.finalEntryId,
          errorMessage: event.data.error.message,
        },
      }
    case 'run.aborted':
      if (base.terminal) return base
      return {
        ...base,
        terminal: { status: 'aborted', finalEntryId: event.data.finalEntryId, errorMessage: null },
      }
    default:
      return base
  }
}
