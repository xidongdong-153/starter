import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  Models,
  SimpleStreamOptions,
  Usage,
} from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream, ModelsError } from '@earendil-works/pi-ai'
import type {
  AiCost,
  AiModelCallResult,
  AiModelCallStopReason,
  AiModelRef,
  AiUsage,
  ApiErrorCode,
} from '@starter/contracts'
import { ApiErrorCodes } from '@starter/contracts'
import { NOOP_TELEMETRY_CONTEXT } from '@earendil-works/pi-telemetry'
import type { AiSpan, AiTelemetryTarget } from '@api/infra/telemetry/index.js'
import { startAiSpan } from '@api/infra/telemetry/index.js'
import type { RunExecutionContext } from '@api/infra/agent/run-execution-context.js'
import type { PrincipalContext, ResourceScope } from '@api/modules/ai/principal.js'
import { generateId } from '@api/shared/id.js'

export interface PiModelCallAudit {
  beginModelCall: (input: {
    /** 由调用方在 Provider 请求前生成，审计直接用这个 ID。 */
    id: string
    runId: string
    userId: string
    scope?: ResourceScope
    principalKind?: PrincipalContext['kind']
    appId?: string | null
    externalUserId?: string | null
    requestId: string
    model: AiModelRef
    api?: string | null
    timeoutMs: number
    startedAt: Date
    turnId?: string | null
    stepId?: string | null
  }) => string | null
  finalizeModelCall: (input: {
    id: string
    requestId: string
    startedAt: Date
    finishedAt: Date
    result: Exclude<AiModelCallResult, 'running'>
    stopReason: AiModelCallStopReason | null
    errorCode: string | null
    usage: AiUsage
    cost: AiCost | null
    ttftMs?: number | null
    chunkCount?: number | null
    responseModel?: string | null
    responseId?: string | null
    httpStatus?: number | null
  }) => void
}

export interface PiNativeStreamOptions {
  models: Models
  timeoutMs: number
  /** Run Service 创建的关联上下文；Run、Turn、Step 和 principal 全部从它读。 */
  execution: RunExecutionContext
  getProviderRequestEnv?: (providerId: string) => Record<string, string>
  audit?: PiModelCallAudit
  /** 当前 Step 的 telemetry 父作用域，每次 Provider 请求读取一次。 */
  getTelemetryParent?: () => AiTelemetryTarget | undefined
  /** Model Call 生命周期事实；由 executor 转成产品事件，本文件不组装事件。 */
  onModelCallFact?: (fact: PiModelCallFact) => void
  onFailure?: (failure: PiStreamFailure) => void
}

export interface PiStreamFailure {
  kind: 'auth' | 'timeout' | 'aborted' | 'upstream' | 'model_not_found'
  errorCode: ApiErrorCode
}

/** 一次 Provider 请求的安全事实，不包含 prompt、消息正文和 Provider 原始错误。 */
export type PiModelCallFact =
  | {
      kind: 'started'
      modelCallId: string
      providerId: string
      modelId: string
      api: string
    }
  | { kind: 'first_output'; modelCallId: string; elapsedMs: number }
  | {
      kind: 'completed'
      modelCallId: string
      responseModel: string | null
      responseId: string | null
      stopReason: AiModelCallStopReason
      usage: AiUsage
      cost: AiCost | null
    }
  | { kind: 'failed'; modelCallId: string; errorCode: ApiErrorCode }

export function createPiNativeStreamFn(
  options: PiNativeStreamOptions,
): (model: Model<Api>, context: Context, streamOptions?: SimpleStreamOptions) => AssistantMessageEventStream {
  return (model, context, streamOptions = {}) => {
    const result = createAssistantMessageEventStream()
    const execution = options.execution
    // Model span 包住整个 Provider 请求；parent 只来自调用方显式传入的 Step 作用域。
    void startAiSpan(
      options.getTelemetryParent?.() ?? NOOP_TELEMETRY_CONTEXT,
      'starter.ai.model_call',
      {
        'starter.ai.run.id': execution.runId,
        'starter.ai.turn.id': execution.turnId ?? undefined,
        'starter.ai.step.id': execution.step?.id ?? undefined,
        'starter.ai.provider': model.provider,
        'starter.ai.model': model.id,
        'starter.ai.api': model.api,
        'starter.ai.streaming': true,
      },
      (span) => pumpStream(result, model, context, streamOptions, options, span),
    )
    return result
  }
}

export const createNativePiStreamFn = createPiNativeStreamFn

async function pumpStream(
  result: AssistantMessageEventStream,
  model: Model<Api>,
  context: Context,
  streamOptions: SimpleStreamOptions,
  options: PiNativeStreamOptions,
  span: AiSpan<'starter.ai.model_call'>,
): Promise<void> {
  const modelLookup = options.models.getModel
  const listedModel =
    typeof modelLookup === 'function' ? modelLookup.call(options.models, model.provider, model.id) : model
  if (!listedModel) {
    const failure = streamFailure('model_not_found')
    result.push({
      type: 'error',
      reason: 'error',
      error: errorMessage(model, 'model_not_found'),
    })
    span.setAttributes({
      'starter.ai.error.code': failure.errorCode,
      'starter.ai.error.type': 'model_not_found',
    })
    span.setStatus({ status: 'error' })
    try {
      options.onFailure?.(failure)
    } catch {
      // 失败回调不能阻止 StreamFn 结束。
    }
    return
  }
  model = listedModel

  const timeoutMs = Math.max(1, Math.min(streamOptions.timeoutMs ?? options.timeoutMs, options.timeoutMs))
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs)
  const cause: { kind: PiStreamFailure['kind'] | null } = {
    kind: streamOptions.signal?.aborted ? 'aborted' : null,
  }
  const onInputAbort = () => {
    cause.kind ??= 'aborted'
  }
  const onTimeout = () => {
    cause.kind ??= 'timeout'
  }
  streamOptions.signal?.addEventListener('abort', onInputAbort, { once: true })
  timeoutController.signal.addEventListener('abort', onTimeout, { once: true })
  const signal = AbortSignal.any(
    streamOptions.signal ? [streamOptions.signal, timeoutController.signal] : [timeoutController.signal],
  )
  const startedAt = new Date()
  const execution = options.execution
  // modelCallId 在 Provider 请求开始前生成，不依赖 audit 是否注入。
  const modelCallId = generateId()
  let auditId: string | null = null
  let iterator: AsyncIterator<AssistantMessageEvent> | undefined
  let finalized = false
  let chunkCount = 0
  let firstOutputAt: number | undefined
  let httpStatusCode: number | undefined
  let responseModel: string | undefined
  let responseId: string | undefined

  const publishFact = (fact: PiModelCallFact): void => {
    try {
      options.onModelCallFact?.(fact)
    } catch {
      // 事实回调不能改变 StreamFn 的行为。
    }
  }

  const recordResponse = (message: AssistantMessage): void => {
    responseModel = message.responseModel ?? undefined
    responseId = message.responseId ?? undefined
  }

  const finalize = (
    resultValue: Exclude<AiModelCallResult, 'running'>,
    stopReason: AiModelCallStopReason | null,
    errorCode: string | null,
    usage: AiUsage,
    cost: AiCost | null,
  ) => {
    if (finalized) return
    finalized = true
    span.setAttributes({
      'starter.ai.model_call.id': modelCallId,
      'starter.ai.model_call.result': resultValue,
      'starter.ai.response.model': responseModel,
      'starter.ai.response.id': responseId,
      'starter.ai.response.stop_reason': stopReason ?? undefined,
      'starter.ai.http.status_code': httpStatusCode,
      'starter.ai.usage.input_tokens': usage.inputTokens ?? undefined,
      'starter.ai.usage.output_tokens': usage.outputTokens ?? undefined,
      'starter.ai.usage.cache_read_tokens': usage.cacheReadTokens ?? undefined,
      'starter.ai.usage.cache_write_tokens': usage.cacheWriteTokens ?? undefined,
      'starter.ai.usage.reasoning_tokens': usage.reasoningTokens ?? undefined,
      'starter.ai.usage.total_tokens': usage.totalTokens ?? undefined,
      'starter.ai.usage.cost': cost?.total ?? undefined,
      'starter.ai.stream.chunk_count': chunkCount,
      'starter.ai.stream.time_to_first_output_ms':
        firstOutputAt === undefined ? undefined : firstOutputAt - startedAt.getTime(),
      'starter.ai.duration_ms': Date.now() - startedAt.getTime(),
      'starter.ai.error.code': errorCode ?? undefined,
      'starter.ai.error.type': telemetryErrorType(errorCode),
    })
    if (resultValue !== 'succeeded') span.setStatus({ status: 'error' })
    publishFact(
      resultValue === 'succeeded' && stopReason !== null
        ? {
            kind: 'completed',
            modelCallId,
            responseModel: responseModel ?? null,
            responseId: responseId ?? null,
            stopReason,
            usage,
            cost,
          }
        : {
            kind: 'failed',
            modelCallId,
            errorCode: toApiErrorCode(errorCode),
          },
    )
    if (auditId) {
      try {
        options.audit?.finalizeModelCall({
          id: auditId,
          requestId: execution.requestId,
          startedAt,
          finishedAt: new Date(),
          result: resultValue,
          stopReason,
          errorCode,
          usage,
          cost,
          ttftMs: firstOutputAt === undefined ? null : firstOutputAt - startedAt.getTime(),
          chunkCount,
          responseModel: responseModel ?? null,
          responseId: responseId ?? null,
          httpStatus: httpStatusCode ?? null,
        })
      } catch {
        // 审计是 best-effort，不能阻断模型事件流。
      }
    }
  }

  try {
    try {
      auditId =
        options.audit?.beginModelCall({
          id: modelCallId,
          runId: execution.runId,
          userId: execution.userId,
          scope: execution.scope,
          principalKind: execution.principal.kind,
          appId: execution.principal.appId,
          externalUserId: execution.principal.externalUserId,
          requestId: execution.requestId,
          model: { providerId: model.provider, modelId: model.id },
          api: model.api,
          turnId: execution.turnId,
          stepId: execution.step?.id ?? null,
          timeoutMs,
          startedAt,
        }) ?? null
    } catch {
      auditId = null
    }
    publishFact({
      kind: 'started',
      modelCallId,
      providerId: model.provider,
      modelId: model.id,
      api: model.api,
    })

    const env = options.getProviderRequestEnv?.(model.provider) ?? {}
    const auth = await options.models.getAuth(model, {
      env,
      signal,
      ...(streamOptions.apiKey ? { apiKey: streamOptions.apiKey } : {}),
    })
    if (signal.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError')
    }
    if (!auth) {
      const failure = streamFailure('auth')
      const message = errorMessage(model, 'auth')
      result.push({ type: 'error', reason: 'error', error: message })
      finalize('auth_failed', 'error', failure.errorCode, emptyUsage(), null)
      options.onFailure?.(failure)
      return
    }

    const upstream = options.models.streamSimple(model, context, {
      ...streamOptions,
      env,
      signal,
      timeoutMs,
      maxRetries: 0,
      maxTokens: model.maxTokens,
      sessionId: execution.sessionId,
      onResponse: (response, responseModelRef) => {
        // 只取 HTTP 状态码当 telemetry 属性，不读 header 和 body。
        httpStatusCode = response.status
        return streamOptions.onResponse?.(response, responseModelRef)
      },
    })
    let terminal = false
    iterator = upstream[Symbol.asyncIterator]()
    while (true) {
      const next = await nextWithSignal(iterator, signal)
      if (next.done) break
      const event = next.value
      if (event.type === 'done') {
        recordResponse(event.message)
        if (cause.kind === 'aborted' || cause.kind === 'timeout') {
          const failure = streamFailure(cause.kind)
          result.push({
            type: 'error',
            reason: 'aborted',
            error: sanitizeErrorMessage(event.message, model, failure.kind),
          })
          finalize(
            cause.kind === 'timeout' ? 'timed_out' : 'cancelled',
            'aborted',
            failure.errorCode,
            toUsage(event.message.usage),
            toCost(event.message.usage),
          )
          options.onFailure?.(failure)
        } else if (event.reason === 'deferred') {
          const failure = streamFailure('upstream')
          const message = errorMessage(model, 'upstream')
          result.push({ type: 'error', reason: 'error', error: message })
          finalize(
            'upstream_failed',
            'deferred',
            failure.errorCode,
            toUsage(event.message.usage),
            toCost(event.message.usage),
          )
          options.onFailure?.(failure)
        } else {
          result.push({
            type: 'done',
            reason: event.reason,
            message: sanitizeAssistantMessage(event.message),
          })
          finalize(
            'succeeded',
            normalizeStopReason(event.reason),
            null,
            toUsage(event.message.usage),
            toCost(event.message.usage),
          )
        }
        terminal = true
        return
      }
      if (event.type === 'error') {
        recordResponse(event.error)
        const failure = streamFailure(cause.kind ?? (event.reason === 'aborted' ? 'aborted' : 'upstream'))
        result.push({
          type: 'error',
          reason: failure.kind === 'aborted' || failure.kind === 'timeout' ? 'aborted' : 'error',
          error: sanitizeErrorMessage(event.error, model, failure.kind),
        })
        finalize(
          failure.kind === 'timeout' ? 'timed_out' : failure.kind === 'aborted' ? 'cancelled' : 'upstream_failed',
          failure.kind === 'timeout' || failure.kind === 'aborted' ? 'aborted' : 'error',
          failure.errorCode,
          toUsage(event.error.usage),
          toCost(event.error.usage),
        )
        options.onFailure?.(failure)
        terminal = true
        return
      }
      result.push(sanitizeEvent(event))
      chunkCount += 1
      // TTFT 只记首个内容 update，start 是协议事件不算首输出。
      if (event.type !== 'start' && firstOutputAt === undefined) {
        firstOutputAt = Date.now()
        publishFact({
          kind: 'first_output',
          modelCallId,
          elapsedMs: firstOutputAt - startedAt.getTime(),
        })
      }
    }

    if (!terminal) {
      const failure = streamFailure(cause.kind ?? 'upstream')
      result.push({
        type: 'error',
        reason: failure.kind === 'aborted' || failure.kind === 'timeout' ? 'aborted' : 'error',
        error: errorMessage(model, failure.kind),
      })
      finalize(
        failure.kind === 'timeout' ? 'timed_out' : failure.kind === 'aborted' ? 'cancelled' : 'upstream_failed',
        failure.kind === 'timeout' || failure.kind === 'aborted' ? 'aborted' : 'error',
        failure.errorCode,
        emptyUsage(),
        null,
      )
      options.onFailure?.(failure)
    }
  } catch (error) {
    const failure = classifyFailure(error, cause.kind, signal)
    const message = errorMessage(model, failure.kind)
    result.push({
      type: 'error',
      reason: failure.kind === 'aborted' || failure.kind === 'timeout' ? 'aborted' : 'error',
      error: message,
    })
    finalize(
      failure.kind === 'timeout'
        ? 'timed_out'
        : failure.kind === 'aborted'
          ? 'cancelled'
          : failure.kind === 'auth'
            ? 'auth_failed'
            : 'upstream_failed',
      failure.kind === 'timeout' || failure.kind === 'aborted' ? 'aborted' : 'error',
      failure.errorCode,
      emptyUsage(),
      null,
    )
    options.onFailure?.(failure)
  } finally {
    if (typeof iterator?.return === 'function') {
      try {
        await iterator.return()
      } catch {
        // 取消时尽力关闭 Provider iterator，保留原始终态。
      }
    }
    clearTimeout(timeout)
    streamOptions.signal?.removeEventListener('abort', onInputAbort)
    timeoutController.signal.removeEventListener('abort', onTimeout)
  }
}

function sanitizeEvent(
  event: Exclude<AssistantMessageEvent, { type: 'done' | 'error' }>,
): Exclude<AssistantMessageEvent, { type: 'done' | 'error' }> {
  if (event.type === 'start') {
    return { type: 'start', partial: sanitizeAssistantMessage(event.partial) }
  }
  if (event.type === 'toolcall_end') {
    return {
      ...event,
      partial: sanitizeAssistantMessage(event.partial),
      toolCall: {
        type: 'toolCall',
        id: event.toolCall.id,
        name: event.toolCall.name,
        arguments: event.toolCall.arguments,
      },
    }
  }
  return {
    ...event,
    partial: sanitizeAssistantMessage(event.partial),
  } as typeof event
}

function sanitizeErrorMessage(
  message: AssistantMessage,
  model: Model<Api>,
  kind: PiStreamFailure['kind'],
): AssistantMessage {
  return {
    ...sanitizeAssistantMessage(message),
    stopReason: kind === 'aborted' || kind === 'timeout' ? 'aborted' : 'error',
    errorMessage: errorMessage(model, kind).errorMessage,
  }
}

function sanitizeAssistantMessage(message: AssistantMessage): AssistantMessage {
  return {
    role: 'assistant',
    content: message.content.map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text }
      if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking }
      return {
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: block.arguments,
      }
    }),
    api: message.api,
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    stopReason: message.stopReason,
    timestamp: message.timestamp,
    ...(message.errorMessage ? { errorMessage: '模型请求失败' } : {}),
  }
}

function errorMessage(model: Model<Api>, kind: PiStreamFailure['kind'] | 'model_not_found'): AssistantMessage {
  const reason =
    kind === 'auth'
      ? 'Provider 认证失败'
      : kind === 'timeout'
        ? '模型请求超时'
        : kind === 'aborted'
          ? '模型请求已取消'
          : kind === 'model_not_found'
            ? '模型不存在'
            : '模型请求失败'
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyPiUsage(),
    stopReason: kind === 'aborted' || kind === 'timeout' ? 'aborted' : 'error',
    errorMessage: reason,
    timestamp: Date.now(),
  }
}

/** 事实里的错误码只能是稳定的 ApiErrorCode；读不到时归为上游失败。 */
function toApiErrorCode(errorCode: string | null): ApiErrorCode {
  if (errorCode !== null && Object.values(ApiErrorCodes).includes(errorCode as ApiErrorCode)) {
    return errorCode as ApiErrorCode
  }
  return ApiErrorCodes.AI_UPSTREAM_ERROR
}

function streamFailure(kind: PiStreamFailure['kind']): PiStreamFailure {
  return {
    kind,
    errorCode:
      kind === 'auth'
        ? ApiErrorCodes.AI_PROVIDER_AUTH_FAILED
        : kind === 'timeout'
          ? ApiErrorCodes.AI_UPSTREAM_TIMEOUT
          : kind === 'aborted'
            ? ApiErrorCodes.AI_REQUEST_ABORTED
            : kind === 'model_not_found'
              ? ApiErrorCodes.AI_MODEL_NOT_FOUND
              : ApiErrorCodes.AI_UPSTREAM_ERROR,
  }
}

/** telemetry 的 error.type 只记稳定失败分类，不记 Provider 原始错误。 */
function telemetryErrorType(errorCode: string | null): PiStreamFailure['kind'] | undefined {
  if (errorCode === ApiErrorCodes.AI_PROVIDER_AUTH_FAILED) return 'auth'
  if (errorCode === ApiErrorCodes.AI_UPSTREAM_TIMEOUT) return 'timeout'
  if (errorCode === ApiErrorCodes.AI_REQUEST_ABORTED) return 'aborted'
  if (errorCode === ApiErrorCodes.AI_MODEL_NOT_FOUND) return 'model_not_found'
  if (errorCode === ApiErrorCodes.AI_UPSTREAM_ERROR) return 'upstream'
  return undefined
}

function classifyFailure(error: unknown, cause: PiStreamFailure['kind'] | null, signal: AbortSignal): PiStreamFailure {
  if (cause === 'timeout') return streamFailure('timeout')
  if (cause === 'aborted' || signal.aborted) return streamFailure('aborted')
  if (error instanceof ModelsError && (error.code === 'auth' || error.code === 'oauth')) {
    return streamFailure('auth')
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return streamFailure('aborted')
  }
  return streamFailure('upstream')
}

async function nextWithSignal<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  if (signal.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError')
  }
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([iterator.next(), aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function normalizeStopReason(
  reason: Extract<AssistantMessageEvent, { type: 'done' }>['reason'],
): 'stop' | 'length' | 'tool_use' | 'deferred' {
  if (reason === 'length') return 'length'
  if (reason === 'toolUse') return 'tool_use'
  if (reason === 'deferred') return 'deferred'
  return 'stop'
}

function toUsage(usage: Usage): AiUsage {
  return {
    inputTokens: numberOrNull(usage.input),
    outputTokens: numberOrNull(usage.output),
    cacheReadTokens: numberOrNull(usage.cacheRead),
    cacheWriteTokens: numberOrNull(usage.cacheWrite),
    cacheWrite1hTokens: numberOrNull(usage.cacheWrite1h),
    reasoningTokens: numberOrNull(usage.reasoning),
    totalTokens: numberOrNull(usage.totalTokens),
  }
}

function toCost(usage: Usage): AiCost | null {
  const input = numberOrNull(usage.cost?.input)
  const output = numberOrNull(usage.cost?.output)
  const cacheRead = numberOrNull(usage.cost?.cacheRead)
  const cacheWrite = numberOrNull(usage.cost?.cacheWrite)
  const total = numberOrNull(usage.cost?.total)
  if (input === null || output === null || cacheRead === null || cacheWrite === null || total === null) {
    return null
  }
  return { currency: 'USD', input, output, cacheRead, cacheWrite, total }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function emptyUsage(): AiUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  }
}

function emptyPiUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}
