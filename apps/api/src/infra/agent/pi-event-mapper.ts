import type { AgentEvent, AgentMessage, Entry } from '@earendil-works/pi-agent-core'
import type { AgentThinkingLevel, AiSource, AiUsage, ApiErrorCode, RunEvent } from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import type { RunEventDraft } from '@api/modules/ai/run/run-event.repository.js'
import { isAiRetryableErrorCode, toAiErrorCategory } from '@api/modules/ai/ai-error.js'

import type { AgentSessionHandle } from './pi-session-store.js'
import { generateId } from '@api/shared/id.js'
import type { PiToolResultDetails } from './pi-tool-adapter.js'
import { createRunEventDraft, type RunExecutionContext, type RunStepState } from './run-execution-context.js'

/** Step 终态取值与 `ai_run_steps.outcome` 一致。 */
export type RunStepOutcome = Extract<RunEvent, { type: 'step.completed' }>['data']['outcome']

/**
 * Turn 结束时由 executor 回填的终态事实。
 *
 * executor 掌握不在 Pi 事件流上的失败信号（Run deadline、Tool 终止失败、存储失败），
 * 并且负责关闭 Step，所以由它把最终 outcome、已关闭的 Step 和稳定错误码交回 mapper，
 * 保证 `step.completed`、`turn.completed`、`ai_run_steps` 和 span 用同一组值。
 */
export interface PiTurnEndResult {
  outcome: 'succeeded' | 'failed' | 'aborted'
  step: RunStepState | null
  errorCode: ApiErrorCode | null
}

export interface PiEventMapperOptions {
  session: AgentSessionHandle
  /** Run Service 创建的关联上下文；envelope 的关联槽位只来自它。 */
  execution: RunExecutionContext
  maxTurns: number
  /**
   * 已解析的 Agent thinking 级别，决定 thinking 事件的 display policy：
   * `off` 不产生 thinking 事件；其它级别视为调用方显式要求思考可见。
   */
  thinkingLevel: AgentThinkingLevel
  getAssistantErrorCode?: () => ApiErrorCode | null
  onTurnStart?: (turnIndex: number) => void
  /** 返回 Turn 终态事实；返回空时按 Pi 的 assistant stopReason 判定。 */
  onTurnEnd?: (outcome: 'succeeded' | 'failed' | 'aborted') => PiTurnEndResult | void
  onEntryAppended?: (entry: Entry) => void
  onToolExecutionStart?: (input: {
    toolCallId: string
    toolName: string
    args: unknown
    signal?: AbortSignal
  }) => void | Promise<void>
  onToolExecutionEnd?: (input: {
    toolCallId: string
    toolName: string
    result: unknown
    isError: boolean
  }) => PiToolResultDetails | null
}

interface PendingToolExecution {
  toolCallId: string
  name: string
  result: PiToolResultDetails | null
  isError: boolean
}

export class PiEventMapper {
  private readonly pendingMessageIds = new WeakMap<object, string>()
  private readonly pendingTools = new Map<string, PendingToolExecution>()
  private activeAssistant: { id: string } | undefined
  private _lastAssistantEntryId: string | null = null
  private _lastAssistantMessage: AgentMessage | undefined

  constructor(private readonly options: PiEventMapperOptions) {}

  get lastAssistantEntryId(): string | null {
    return this._lastAssistantEntryId
  }

  get lastAssistantMessage(): AgentMessage | undefined {
    return this._lastAssistantMessage
  }

  async map(event: AgentEvent, signal?: AbortSignal): Promise<readonly RunEventDraft[]> {
    switch (event.type) {
      case 'message_start':
        return this.mapMessageStart(event.message)
      case 'message_update':
        return this.mapMessageUpdate(event.message, event.assistantMessageEvent)
      case 'message_end':
        return this.mapMessageEnd(event.message)
      case 'tool_execution_start':
        await this.options.onToolExecutionStart?.({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          signal,
        })
        return [
          this.event('tool.started', {
            toolCallId: event.toolCallId,
            name: event.toolName,
          }),
        ]
      case 'tool_execution_update':
        return [
          this.event('tool.progress', {
            toolCallId: event.toolCallId,
            name: event.toolName,
            safeSummary: readSafeSummary(event.partialResult),
          }),
        ]
      case 'tool_execution_end':
        this.pendingTools.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          name: event.toolName,
          result:
            this.options.onToolExecutionEnd?.({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: event.result,
              isError: event.isError,
            }) ?? readToolDetails(event.result),
          isError: event.isError,
        })
        return []
      case 'turn_start': {
        const turnIndex = (this.options.execution.turnIndex ?? 0) + 1
        this.options.onTurnStart?.(turnIndex)
        const drafts: RunEventDraft[] = [
          this.event('turn.started', {
            maxTurns: this.options.maxTurns,
          }),
        ]
        // onTurnStart 已经开好本轮的 assistant Step，Step 事件用它的真实 ID。
        const step = this.options.execution.step
        if (step) drafts.push(this.stepStartedEvent(step))
        return drafts
      }
      case 'turn_end': {
        // Pi 的 turn_end 只带本轮 assistant message，失败判据就是它的 stopReason：
        // `error` -> failed，`aborted` -> aborted，其它（含 `toolUse`）-> succeeded。
        // Tool 失败不会改写 assistant stopReason，所以 Tool 失败不把 Turn 记成 failed。
        const piOutcome = turnOutcome(event.message)
        const result = this.options.onTurnEnd?.(piOutcome)
        const outcome = result?.outcome ?? piOutcome
        const drafts: RunEventDraft[] = []
        if (result?.step) {
          drafts.push(
            this.stepCompletedEvent({
              step: result.step,
              outcome,
              errorCode: result.errorCode,
            }),
          )
        }
        drafts.push(
          this.event('turn.completed', {
            maxTurns: this.options.maxTurns,
            toolCallCount: event.toolResults.length,
            outcome,
          }),
        )
        return drafts
      }
      case 'agent_start':
      case 'agent_end':
        return []
    }
  }

  private mapMessageStart(message: AgentMessage): readonly RunEventDraft[] {
    if (message.role === 'assistant') {
      const messageId = generateEntryId()
      this.activeAssistant = { id: messageId }
      return [
        this.event('message.started', {
          messageId,
          role: 'assistant',
        }),
      ]
    }

    this.pendingMessageIds.set(message, generateEntryId())
    return []
  }

  private mapMessageUpdate(
    message: AgentMessage,
    assistantMessageEvent: Extract<AgentEvent, { type: 'message_update' }>['assistantMessageEvent'],
  ): readonly RunEventDraft[] {
    if (message.role !== 'assistant') return []
    const messageId = this.activeAssistant?.id
    if (!messageId) return []

    switch (assistantMessageEvent.type) {
      case 'text_delta':
        return [
          this.event('message.delta', {
            messageId,
            delta: assistantMessageEvent.delta,
          }),
        ]
      case 'thinking_start':
        if (!this.thinkingVisible) return []
        return [
          this.event('thinking.started', {
            messageId,
            blockIndex: assistantMessageEvent.contentIndex,
            display: true,
          }),
        ]
      case 'thinking_delta':
        if (!this.thinkingVisible) return []
        return [
          this.event('thinking.delta', {
            messageId,
            blockIndex: assistantMessageEvent.contentIndex,
            delta: assistantMessageEvent.delta,
          }),
        ]
      case 'thinking_end':
        if (!this.thinkingVisible) return []
        return [
          this.event('thinking.completed', {
            messageId,
            blockIndex: assistantMessageEvent.contentIndex,
            display: true,
          }),
        ]
      default:
        return []
    }
  }

  /**
   * thinking display policy：`thinkingLevel` 为 `off` 时不产生 thinking 事件，
   * 其它级别视为调用方已显式要求思考可见，事件保留边界和正文。
   *
   * 正文只允许出现在产品事件和 `ai_run_events` 里；telemetry span 属性和
   * SQLite 审计表仍然不写 reasoning 正文。
   */
  private get thinkingVisible(): boolean {
    return this.options.thinkingLevel !== 'off'
  }

  private async mapMessageEnd(message: AgentMessage): Promise<readonly RunEventDraft[]> {
    if (message.role === 'assistant') {
      const messageId = this.activeAssistant?.id ?? generateEntryId()
      const entry = await this.options.session.appendMessage(
        this.options.execution.lane,
        withRunId(message, this.options.execution.runId),
        messageId,
      )
      this.options.onEntryAppended?.(entry)
      this.activeAssistant = undefined
      this._lastAssistantEntryId = entry.id
      this._lastAssistantMessage = message
      return [
        this.event('message.completed', {
          messageId: entry.id,
          role: 'assistant',
          content: assistantText(message),
          stopReason: toHarnessStopReason(message),
          errorCode: this.assistantErrorCode(message),
          usage: readAssistantUsage(message),
        }),
      ]
    }

    const pending = message.role === 'toolResult' ? this.pendingTools.get(message.toolCallId) : undefined
    const persistedMessage =
      message.role === 'toolResult' ? sanitizeToolResultMessage(message, pending?.result) : message
    const entryId = this.pendingMessageIds.get(message) ?? generateEntryId()
    this.pendingMessageIds.delete(message)
    const entry = await this.options.session.appendMessage(
      this.options.execution.lane,
      withRunId(persistedMessage, this.options.execution.runId),
      entryId,
    )
    this.options.onEntryAppended?.(entry)
    if (message.role !== 'toolResult') return []

    const persistedToolResult = persistedMessage as Extract<AgentMessage, { role: 'toolResult' }>
    const pendingTool = this.pendingTools.get(message.toolCallId)
    this.pendingTools.delete(message.toolCallId)
    const details = pendingTool?.result ?? readToolDetails(persistedToolResult.details)
    const status = details?.status ?? (pendingTool?.isError || message.isError ? 'failed' : 'succeeded')
    const errorCode = details?.errorCode ?? (status === 'succeeded' ? null : ApiErrorCodes.AI_TOOL_FAILED)
    return [
      this.event('tool.completed', {
        toolCallId: message.toolCallId,
        name: message.toolName,
        status,
        errorCode,
        safeSummary: details?.safeSummary ?? null,
        entryId: entry.id,
      }),
    ]
  }

  /**
   * compaction 写入成功后由 executor 调用。
   * compaction 发生在 `transformContext` 回调里，不在 Pi AgentEvent 流上，
   * 所以需要一个显式出口，事实仍然走同一套 envelope 组装。
   * `stepId` 由 executor 传入 compaction Step 的 ID，不复用当前 assistant Step。
   */
  contextCompactedEvent(info: {
    entryId: string
    tokensBefore: number
    summary: string
    stepId: string
  }): RunEventDraft {
    return createRunEventDraft(
      this.options.execution,
      'context.compacted',
      {
        entryId: info.entryId,
        tokensBefore: info.tokensBefore,
        summary: info.summary.slice(0, 1000),
      },
      { stepId: info.stepId },
    )
  }

  /**
   * Step 开始事实。assistant Step 由 Pi `turn_start` 触发，
   * compaction Step 由 executor 在 `transformContext` 里显式调用。
   * `stepId` 一定是 `ai_run_steps` 行和 Step span 用的同一个 ID。
   */
  stepStartedEvent(step: RunStepState): RunEventDraft {
    return createRunEventDraft(
      this.options.execution,
      'step.started',
      { kind: step.kind, attempt: step.attempt },
      { stepId: step.id },
    )
  }

  /** Step 终态事实；错误类别和 retryable 只从稳定错误码推导。 */
  stepCompletedEvent(input: {
    step: RunStepState
    outcome: RunStepOutcome
    errorCode: ApiErrorCode | null
  }): RunEventDraft {
    return createRunEventDraft(
      this.options.execution,
      'step.completed',
      {
        kind: input.step.kind,
        attempt: input.step.attempt,
        outcome: input.outcome,
        error:
          input.errorCode === null
            ? null
            : {
                code: input.errorCode,
                category: toAiErrorCategory(input.errorCode),
                retryable: isAiRetryableErrorCode(input.errorCode),
              },
      },
      { stepId: input.step.id },
    )
  }

  /**
   * 工具上报的引用来源。参数已由 Tool adapter 按 contracts schema 和
   * 引用型 URL 规则校验，这里只负责 envelope 组装。
   */
  sourceAvailableEvent(fact: { toolCallId: string; source: AiSource }): RunEventDraft {
    return createRunEventDraft(this.options.execution, 'source.available', fact.source, { toolCallId: fact.toolCallId })
  }

  private assistantErrorCode(message: AgentMessage): ApiErrorCode | null {
    if (message.role !== 'assistant') return null
    if (message.stopReason !== 'error' && message.stopReason !== 'aborted') {
      return null
    }
    return (
      this.options.getAssistantErrorCode?.() ??
      (message.stopReason === 'aborted' ? ApiErrorCodes.AI_REQUEST_ABORTED : ApiErrorCodes.AI_UPSTREAM_ERROR)
    )
  }

  private event<T extends RunEvent['type']>(type: T, data: unknown): RunEventDraft {
    return createRunEventDraft<RunEvent['type']>(
      this.options.execution,
      type,
      normalizeEventData(type, data) as RunEvent['data'],
      {
        messageId: readAssociationId(data, 'messageId'),
        toolCallId: readAssociationId(data, 'toolCallId'),
      },
    )
  }
}

/**
 * Turn 终态只从 Pi `turn_end` 带的 assistant message 推导。
 * `stopReason` 是 Pi agent loop 自己判断是否终止的依据（agent-loop.ts 在
 * `error` / `aborted` 时直接发 turn_end + agent_end），Tool 失败不会改写它。
 */
function turnOutcome(message: AgentMessage): 'succeeded' | 'failed' | 'aborted' {
  if (message.role !== 'assistant') return 'succeeded'
  if (message.stopReason === 'aborted') return 'aborted'
  if (message.stopReason === 'error') return 'failed'
  return 'succeeded'
}

function readAssociationId(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

function normalizeEventData(type: RunEvent['type'], value: unknown): unknown {
  const data = (value ?? {}) as Record<string, unknown>
  switch (type) {
    case 'message.started':
      return { role: data.role, partPolicy: 'text_and_thinking' }
    case 'message.delta':
      return { partId: data.messageId, delta: data.delta }
    case 'thinking.started':
      return { blockIndex: data.blockIndex, display: data.display === true }
    case 'thinking.delta':
      return { blockIndex: data.blockIndex, delta: data.delta }
    // 思考正文已经通过 thinking.delta 送达，完成事件不再重复一份截断副本。
    case 'thinking.completed':
      return {
        blockIndex: data.blockIndex,
        display: data.display === true,
        summary: null,
      }
    case 'tool.started':
      return { name: data.name, version: '1.0.0' }
    case 'tool.progress':
      return { summary: data.safeSummary ?? '', state: 'running' }
    case 'tool.completed':
      return {
        name: data.name,
        version: '1.0.0',
        status: data.status,
        summary: data.safeSummary ?? null,
        entryId: data.entryId ?? null,
        error: data.error ?? null,
      }
    case 'turn.started':
      return { stepLimit: data.maxTurns }
    case 'turn.completed':
      return {
        stepCount: data.toolCallCount ?? 0,
        toolCount: data.toolCallCount ?? 0,
        outcome: data.outcome ?? 'succeeded',
      }
    case 'message.completed': {
      const normalized = { ...data }
      delete normalized.messageId
      delete normalized.errorCode
      if (normalized.usage === null) delete normalized.usage
      return normalized
    }
    default:
      return data
  }
}
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: ((result: IteratorResult<T>) => void)[] = []
  private closed = false
  private failure: unknown

  constructor(private readonly maxSize?: number) {}

  push(value: T): void {
    if (this.closed) return
    if (this.maxSize !== undefined && this.values.length >= this.maxSize) {
      // 有界缓冲超限：关闭该 transport，不阻塞生产者（Agent loop 不受影响）。
      this.end()
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.values.push(value)
  }

  end(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined })
    }
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.failure = error
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({
            done: false,
            value: this.values.shift() as T,
          })
        }
        if (this.closed) {
          if (this.failure) return Promise.reject(this.failure)
          return Promise.resolve({ done: true, value: undefined })
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      },
      return: async () => {
        this.end()
        return { done: true, value: undefined }
      },
    }
  }
}

function readAssistantUsage(message: Extract<AgentMessage, { role: 'assistant' }>): AiUsage | null {
  const usage = message.usage
  if (!isRecord(usage)) return null
  return {
    inputTokens: readTokenCount(usage.input),
    outputTokens: readTokenCount(usage.output),
    cacheReadTokens: readTokenCount(usage.cacheRead),
    cacheWriteTokens: readTokenCount(usage.cacheWrite),
    cacheWrite1hTokens: readTokenCount(usage.cacheWrite1h),
    reasoningTokens: readTokenCount(usage.reasoning),
    totalTokens: readTokenCount(usage.totalTokens),
  }
}

function readTokenCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null
  }
  return value
}

function readToolDetails(value: unknown): PiToolResultDetails | null {
  if (!isRecord(value)) return null
  const details = isRecord(value.details) ? value.details : value
  const status = details.status
  if (
    status !== 'succeeded' &&
    status !== 'not_found' &&
    status !== 'invalid_arguments' &&
    status !== 'forbidden' &&
    status !== 'failed' &&
    status !== 'timed_out' &&
    status !== 'cancelled' &&
    status !== 'interrupted'
  ) {
    return null
  }
  return {
    status,
    errorCode: readErrorCode(details.errorCode),
    safeSummary: readSafeSummary(value),
    modelText: typeof details.modelText === 'string' ? details.modelText : '',
    terminate: value.terminate === true || details.terminate === true,
  }
}

function readSafeSummary(value: unknown): string | null {
  if (isRecord(value)) {
    const direct = value.safeSummary
    const nested = isRecord(value.details) ? value.details.safeSummary : null
    value = direct ?? nested
  }
  return typeof value === 'string' ? value.slice(0, 1000) : null
}

function readErrorCode(value: unknown): ApiErrorCode | null {
  if (typeof value !== 'string') return null
  return Object.values(ApiErrorCodes).includes(value as ApiErrorCode) ? (value as ApiErrorCode) : null
}

function sanitizeToolResultMessage(
  message: Extract<AgentMessage, { role: 'toolResult' }>,
  overrideDetails: PiToolResultDetails | null | undefined = undefined,
): Extract<AgentMessage, { role: 'toolResult' }> {
  const details = overrideDetails ?? readToolDetails(message.details)
  const safeDetails =
    details ??
    (message.isError
      ? {
          status: 'failed' as const,
          errorCode: ApiErrorCodes.AI_TOOL_FAILED,
          safeSummary: null,
          modelText: 'The tool failed.',
          terminate: false,
        }
      : message.details)
  return {
    role: 'toolResult',
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: message.isError && safeDetails ? [{ type: 'text', text: safeDetails.modelText }] : message.content,
    ...(safeDetails === undefined ? {} : { details: safeDetails }),
    ...(message.usage === undefined ? {} : { usage: message.usage }),
    ...(message.addedToolNames === undefined ? {} : { addedToolNames: message.addedToolNames }),
    isError: message.isError,
    timestamp: message.timestamp,
  }
}
function assistantText(message: Extract<AgentMessage, { role: 'assistant' }>): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function toHarnessStopReason(
  message: Extract<AgentMessage, { role: 'assistant' }>,
): 'stop' | 'length' | 'tool_use' | null {
  if (message.stopReason === 'stop') return 'stop'
  if (message.stopReason === 'length') return 'length'
  if (message.stopReason === 'toolUse') return 'tool_use'
  return null
}

function generateEntryId(): string {
  return generateId()
}

/**
 * 写入侧 runId 挂载（S5 契约）：在 message 上附加 runId，toolResult 同时
 * 附加到 details。Pi SQLite backend 对 message 原样 JSON 持久化，附加字段
 * 不影响 Pi 的 buildSessionContext / convertToLlm；S5 读取侧优先读
 * message.runId，其次 message.details.runId。
 */
function withRunId(message: AgentMessage, runId: string): AgentMessage {
  if (message.role === 'toolResult') {
    const details = isRecord(message.details) ? { ...message.details, runId } : { runId }
    return {
      ...message,
      runId,
      details,
    } as unknown as AgentMessage
  }
  return { ...message, runId } as unknown as AgentMessage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
