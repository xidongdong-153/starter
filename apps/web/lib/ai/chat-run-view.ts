import type { AgentRunLiveSnapshot, AgentRunStatus, ApiErrorCode } from '@starter/contracts'

import type { ChatRunState } from './chat-events'
import { createChatRunState } from './chat-events'

export interface ChatNotice {
  kind: 'auth' | 'error' | 'info'
  message: string
  /** 有值时页面显示重试按钮，重试用这段文本重新发送。 */
  retryText?: string
}

/** 用 API 的 live 快照覆盖本地 timeline；断流后 API 的折叠结果是权威值。 */
export function applyLiveSnapshot(state: ChatRunState | null, live: AgentRunLiveSnapshot): ChatRunState {
  const base = state ?? createChatRunState(live.maxTurns)
  return {
    ...base,
    lastSequence: live.lastSequence,
    maxTurns: live.maxTurns,
    // 覆盖后不再续写 delta，thinking 块的下标映射作废。
    thinkingBlocks: new Map(),
    timeline: live.timeline,
    turn: live.turn,
  }
}

/**
 * Run 终态对应的页面提示；completed 不提示。
 *
 * 失败时以 API 的可读说明为主文案，错误码放括号里做附注；
 * 轮询路径拿不到说明（`AgentRun` 只有 errorCode）时只显示错误码。
 */
export function terminalNotice(
  status: AgentRunStatus,
  errorCode: ApiErrorCode | null,
  errorMessage: string | null = null,
): ChatNotice | null {
  if (status === 'failed') return { kind: 'error', message: failureMessage(errorCode, errorMessage) }
  if (status === 'aborted') return { kind: 'info', message: '已停止生成。' }
  if (status === 'interrupted') return { kind: 'error', message: '运行被中断，可以重新发送。' }
  return null
}

/** 主文案用 API 的说明，错误码当附注；没有说明时只显示错误码。 */
function failureMessage(errorCode: ApiErrorCode | null, errorMessage: string | null): string {
  if (errorMessage === null || errorMessage.length === 0) return `运行失败：${errorCode ?? '未返回错误码'}`
  return errorCode === null ? `运行失败：${errorMessage}` : `运行失败：${errorMessage}（${errorCode}）`
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return '请求失败，请稍后重试。'
}
