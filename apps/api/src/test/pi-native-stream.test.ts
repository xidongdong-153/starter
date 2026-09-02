import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Context, Model, Models, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { InMemoryTelemetryContext } from '@earendil-works/pi-telemetry'
import { createPiNativeStreamFn } from '@api/infra/ai/pi-native-stream.js'
import { testRunExecution } from '@api/test/run-execution.js'
import { createAiTelemetryContext } from '@api/infra/telemetry/index.js'
import { ApiErrorCodes } from '@starter/contracts'
import { describe, expect, it, vi } from 'vitest'

const model: Model<Api> = {
  id: 'native-model',
  name: 'Native model',
  api: 'openai-completions',
  provider: 'native-provider',
  baseUrl: 'https://example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_000,
  maxTokens: 1024,
}

function assistant(stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'safe answer' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 2,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
    },
    stopReason,
    timestamp: Date.now(),
  }
}

function modelsWith(
  streamSimple: Models['streamSimple'],
  getAuth: Models['getAuth'] = async () => ({
    auth: {},
    source: 'test',
  }),
): Models {
  return {
    getAuth,
    streamSimple,
  } as unknown as Models
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of values) result.push(value)
  return result
}

/** 审计 mock 按真实实现回传调用方给的 modelCallId。 */
function audit() {
  const ids: string[] = []
  return {
    ids,
    beginModelCall: vi.fn((input: { id: string }) => {
      ids.push(input.id)
      return input.id
    }),
    finalizeModelCall: vi.fn(),
  }
}

describe('pi native StreamFn', () => {
  it('通过 Models.streamSimple 返回原生 AssistantMessageEventStream，并完成 run 审计', async () => {
    const upstream = createAssistantMessageEventStream()
    upstream.push({ type: 'start', partial: assistant('pending') })
    upstream.push({ type: 'done', reason: 'stop', message: assistant('stop') })
    const modelAudit = audit()
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => upstream)),
      timeoutMs: 1000,
      execution: testRunExecution({ runId: 'run-1' }),
      audit: modelAudit,
    })

    const stream = streamFn(model, { messages: [] })
    const events = await collect(stream)

    expect(events.map((event) => event.type)).toEqual(['start', 'done'])
    expect(await stream.result()).toMatchObject({ stopReason: 'stop' })
    expect(modelAudit.beginModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        userId: 'user-1',
        requestId: 'request-1',
        model: { providerId: model.provider, modelId: model.id },
      }),
    )
    expect(modelAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: modelAudit.ids[0],
        result: 'succeeded',
        stopReason: 'stop',
      }),
    )
  })

  it('审计 begin 失败时仍返回 Provider 事件流', async () => {
    const upstream = createAssistantMessageEventStream()
    upstream.push({ type: 'done', reason: 'stop', message: assistant('stop') })
    const modelAudit = {
      beginModelCall: vi.fn(() => {
        throw new Error('sensitive-audit-error')
      }),
      finalizeModelCall: vi.fn(),
    }
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => upstream)),
      timeoutMs: 1000,
      execution: testRunExecution({ runId: 'run-audit-failure' }),
      audit: modelAudit,
    })

    await expect(collect(streamFn(model, { messages: [] }))).resolves.toMatchObject([{ type: 'done', reason: 'stop' }])
    expect(modelAudit.finalizeModelCall).not.toHaveBeenCalled()
  })
  it('provider error、timeout 和 abort 都编码为安全 error event，不泄露原始错误', async () => {
    const errorMessage = assistant('error')
    errorMessage.errorMessage = 'provider-secret-marker'
    const modelAudit = audit()
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(
        vi.fn(() => {
          throw new Error('provider-secret-marker')
        }),
      ),
      timeoutMs: 1000,
      execution: testRunExecution({ runId: 'run-2' }),
      audit: modelAudit,
    })
    const errorEvents = await collect(streamFn(model, { messages: [] }))

    expect(JSON.stringify(errorEvents)).not.toContain('provider-secret-marker')
    expect(errorEvents).toMatchObject([
      {
        type: 'error',
        reason: 'error',
        error: { errorMessage: '模型请求失败' },
      },
    ])
    expect(modelAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'upstream_failed',
        errorCode: ApiErrorCodes.AI_UPSTREAM_ERROR,
      }),
    )

    const timeoutAudit = audit()
    const never = createAssistantMessageEventStream()
    const timeoutFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => never)),
      timeoutMs: 10,
      execution: testRunExecution({ runId: 'run-3' }),
      audit: timeoutAudit,
    })
    const timeoutEvents = await collect(timeoutFn(model, { messages: [] }))
    expect(timeoutEvents).toMatchObject([{ type: 'error', reason: 'aborted' }])
    expect(timeoutAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'timed_out',
        errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
      }),
    )

    const abortAudit = audit()
    const abortController = new AbortController()
    const abortStream = createAssistantMessageEventStream()
    const abortFn = createPiNativeStreamFn({
      models: modelsWith(
        vi.fn((_requestModel: Model<Api>, _context: Context, options?: SimpleStreamOptions) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              abortStream.push({
                type: 'done',
                reason: 'stop',
                message: assistant('stop'),
              })
            },
            { once: true },
          )
          return abortStream
        }),
      ),
      timeoutMs: 1000,
      execution: testRunExecution({ runId: 'run-4' }),
      audit: abortAudit,
    })
    const abortEventsPromise = collect(abortFn(model, { messages: [] }, { signal: abortController.signal }))
    abortController.abort()
    expect(await abortEventsPromise).toMatchObject([{ type: 'error', reason: 'aborted' }])
    expect(abortAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'cancelled',
        errorCode: ApiErrorCodes.AI_REQUEST_ABORTED,
      }),
    )
  })

  it('保留安全的 assistant partial content，同时过滤原始 Provider error', async () => {
    const upstream = createAssistantMessageEventStream()
    const partial = assistant('error')
    partial.errorMessage = 'provider-secret-marker'
    upstream.push({ type: 'start', partial })
    upstream.push({ type: 'error', reason: 'error', error: partial })
    const modelAudit = audit()
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(vi.fn(() => upstream)),
      timeoutMs: 1000,
      execution: testRunExecution({ runId: 'run-partial' }),
      audit: modelAudit,
    })

    const events = await collect(streamFn(model, { messages: [] }))

    expect(JSON.stringify(events)).not.toContain('provider-secret-marker')
    expect(events).toMatchObject([
      { type: 'start' },
      {
        type: 'error',
        error: {
          content: [{ type: 'text', text: 'safe answer' }],
          errorMessage: '模型请求失败',
        },
      },
    ])
  })

  it('model_call span 记录 provider、usage、chunk count、TTFT 和 HTTP 状态码', async () => {
    const recorder = new InMemoryTelemetryContext()
    const telemetry = createAiTelemetryContext(recorder)
    const telemetryExecution = testRunExecution({ runId: 'run-telemetry' })
    telemetryExecution.beginTurn(1)
    telemetryExecution.beginStep('assistant', 1)
    const upstream = createAssistantMessageEventStream()
    const pending = assistant('pending')
    const done: AssistantMessage = {
      ...assistant('stop'),
      responseModel: 'native-model-2025',
      responseId: 'provider-response-9',
    }
    upstream.push({ type: 'start', partial: pending })
    setTimeout(
      () =>
        upstream.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: 'safe ',
          partial: pending,
        }),
      30,
    )
    setTimeout(
      () =>
        upstream.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: 'answer',
          partial: pending,
        }),
      60,
    )
    setTimeout(() => upstream.push({ type: 'done', reason: 'stop', message: done }), 90)
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(
        vi.fn((requestModel: Model<Api>, _context: Context, options?: SimpleStreamOptions) => {
          void options?.onResponse?.({ status: 200, headers: {} }, requestModel)
          return upstream
        }),
      ),
      timeoutMs: 5000,
      execution: telemetryExecution,
      audit: audit(),
      getTelemetryParent: () => telemetry,
    })

    const events = await collect(streamFn(model, { messages: [] }))
    expect(events.map((event) => event.type)).toEqual(['start', 'text_delta', 'text_delta', 'done'])

    const spans = recorder.getSpans()
    expect(spans.map((span) => span.name)).toEqual(['starter.ai.model_call'])
    const span = spans[0]
    if (!span) throw new Error('缺少 model_call span')
    expect(span.attributes).toMatchObject({
      'starter.ai.run.id': 'run-telemetry',
      'starter.ai.turn.id': telemetryExecution.turnId,
      'starter.ai.step.id': telemetryExecution.step?.id,
      'starter.ai.provider': model.provider,
      'starter.ai.model': model.id,
      'starter.ai.api': model.api,
      'starter.ai.streaming': true,
      'starter.ai.model_call.id': expect.any(String),
      'starter.ai.model_call.result': 'succeeded',
      'starter.ai.response.model': 'native-model-2025',
      'starter.ai.response.id': 'provider-response-9',
      'starter.ai.response.stop_reason': 'stop',
      'starter.ai.http.status_code': 200,
      'starter.ai.usage.input_tokens': 2,
      'starter.ai.usage.output_tokens': 3,
      'starter.ai.usage.total_tokens': 5,
      'starter.ai.usage.cost': 3,
      // start 是协议事件，也计入转发的 update 数量
      'starter.ai.stream.chunk_count': 3,
    })
    const ttft = span.attributes['starter.ai.stream.time_to_first_output_ms']
    const duration = span.attributes['starter.ai.duration_ms']
    expect(typeof ttft).toBe('number')
    expect(typeof duration).toBe('number')
    // TTFT 只记首个内容 update，不是 start 事件，也不是整段耗时
    expect(ttft as number).toBeGreaterThanOrEqual(20)
    expect(ttft as number).toBeLessThan(duration as number)
    expect(span.status).toMatchObject({ status: 'ok' })
    expect(JSON.stringify(spans)).not.toContain('safe answer')
  })

  it('timeout 的 model_call span 记录 timed_out 与 error.type=timeout', async () => {
    const recorder = new InMemoryTelemetryContext()
    const telemetry = createAiTelemetryContext(recorder)
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(() => createAssistantMessageEventStream()),
      timeoutMs: 10,
      execution: testRunExecution({ runId: 'run-telemetry-timeout' }),
      audit: audit(),
      getTelemetryParent: () => telemetry,
    })

    await expect(collect(streamFn(model, { messages: [] }))).resolves.toMatchObject([
      { type: 'error', reason: 'aborted' },
    ])

    const span = recorder.getSpans()[0]
    if (!span) throw new Error('缺少 model_call span')
    expect(span.attributes).toMatchObject({
      'starter.ai.model_call.result': 'timed_out',
      'starter.ai.error.code': ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
      'starter.ai.error.type': 'timeout',
    })
    expect(span.status).toMatchObject({ status: 'error' })
  })

  it('timeout 先于后续 caller abort 时保留 timeout 终态', async () => {
    const modelAudit = audit()
    const controller = new AbortController()
    const laterAbort = setTimeout(() => controller.abort(), 50)
    const streamFn = createPiNativeStreamFn({
      models: modelsWith(() => createAssistantMessageEventStream()),
      timeoutMs: 10,
      execution: testRunExecution({ runId: 'run-timeout-first' }),
      audit: modelAudit,
    })

    try {
      await expect(collect(streamFn(model, { messages: [] }, { signal: controller.signal }))).resolves.toMatchObject([
        { type: 'error', reason: 'aborted' },
      ])
    } finally {
      clearTimeout(laterAbort)
    }
    expect(modelAudit.finalizeModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'timed_out',
        errorCode: ApiErrorCodes.AI_UPSTREAM_TIMEOUT,
      }),
    )
  })
})
