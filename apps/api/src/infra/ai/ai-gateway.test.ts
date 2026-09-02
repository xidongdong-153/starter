import {
  ModelsError,
  createAssistantMessageEventStream,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { AiGatewayError, createAiGateway } from './ai-gateway.js'
import type { AiGatewayEvent, AiGatewayInput } from './ai-gateway.types.js'

function createFixture(timeoutMs = 5_000, tokensPerSecond = 10_000) {
  const faux = fauxProvider({ tokensPerSecond })
  const models = createModels()
  models.setProvider(faux.provider)
  const model = faux.getModel()
  const gateway = createAiGateway(models, timeoutMs)
  const modelRef = { providerId: model.provider, modelId: model.id }
  return { faux, gateway, modelRef, models }
}

async function collect(input: AsyncGenerator<AiGatewayEvent>): Promise<AiGatewayEvent[]> {
  const events: AiGatewayEvent[] = []
  for await (const event of input) events.push(event)
  return events
}

describe('ai gateway message mapper', () => {
  it('映射 system、user、assistant、tool result 和 tool schema，并输出有序项目事件', async () => {
    const { faux, gateway, modelRef } = createFixture()
    faux.setResponses([
      (context, options) => {
        expect(context.systemPrompt).toBe('system instruction')
        expect(context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult'])
        expect(context.messages[0]).toMatchObject({
          role: 'user',
          content: [{ type: 'text', text: 'question' }],
          timestamp: 10,
        })
        expect(context.messages[1]).toMatchObject({
          role: 'assistant',
          content: [
            { type: 'text', text: 'checking' },
            { type: 'toolCall', id: 'previous-call', name: 'lookup' },
          ],
          timestamp: 20,
        })
        expect(context.messages[2]).toMatchObject({
          role: 'toolResult',
          toolCallId: 'previous-call',
          toolName: 'lookup',
          content: [{ type: 'text', text: 'previous result' }],
          isError: false,
          timestamp: 30,
        })
        expect(context.tools).toEqual([
          expect.objectContaining({
            name: 'lookup',
            description: 'Lookup a value',
            parameters: expect.objectContaining({
              type: 'object',
              properties: expect.objectContaining({
                query: expect.any(Object),
              }),
            }),
          }),
        ])
        expect(options?.sessionId).toBe('session-1')
        return fauxAssistantMessage(
          [
            fauxThinking('private reasoning'),
            fauxText('answer'),
            fauxToolCall('lookup', { query: 'next' }, { id: 'next-call' }),
          ],
          { stopReason: 'toolUse', timestamp: 40 },
        )
      },
    ])

    const input: AiGatewayInput = {
      model: modelRef,
      systemPrompt: 'system instruction',
      sessionId: 'session-1',
      turnIndex: 3,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'question',
              turnIndex: 0,
              contentIndex: 0,
              blockId: '0:0',
            },
          ],
          timestamp: 10,
        },
        {
          role: 'assistant',
          blocks: [
            {
              type: 'text',
              text: 'checking',
              turnIndex: 0,
              contentIndex: 0,
              blockId: '0:0',
            },
            {
              type: 'tool_call',
              id: 'previous-call',
              name: 'lookup',
              arguments: { query: 'previous' },
              turnIndex: 0,
              contentIndex: 1,
              blockId: '0:1',
            },
          ],
          timestamp: 20,
        },
        {
          role: 'tool_result',
          toolCallId: 'previous-call',
          toolName: 'lookup',
          content: 'previous result',
          isError: false,
          timestamp: 30,
        },
      ],
      tools: [
        {
          name: 'lookup',
          description: 'Lookup a value',
          parameters: z.object({ query: z.string() }),
        },
      ],
    }

    const events = await collect(gateway.stream(input))
    const deltas = events.filter((event) => event.type === 'text_delta')
    expect(deltas.map((event) => event.text).join('')).toBe('answer')
    expect(deltas).toEqual(
      deltas.map(() =>
        expect.objectContaining({
          type: 'text_delta',
          turnIndex: 3,
          contentIndex: 1,
          blockId: '3:1',
        }),
      ),
    )
    expect(events.at(-2)).toEqual({
      type: 'tool_call_completed',
      id: 'next-call',
      name: 'lookup',
      arguments: { query: 'next' },
      turnIndex: 3,
      contentIndex: 2,
      blockId: '3:2',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      turnIndex: 3,
      stopReason: 'tool_use',
      assistantMessage: {
        role: 'assistant',
        blocks: [
          {
            type: 'text',
            text: 'answer',
            turnIndex: 3,
            contentIndex: 1,
            blockId: '3:1',
          },
          {
            type: 'tool_call',
            id: 'next-call',
            name: 'lookup',
            arguments: { query: 'next' },
            turnIndex: 3,
            contentIndex: 2,
            blockId: '3:2',
          },
        ],
      },
      usage: {
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        cacheReadTokens: expect.any(Number),
        cacheWriteTokens: expect.any(Number),
        cacheWrite1hTokens: null,
        reasoningTokens: null,
        totalTokens: expect.any(Number),
      },
      cost: {
        currency: 'USD',
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    })
    expect(JSON.stringify(events)).not.toContain('private reasoning')
    expect(JSON.stringify(events)).not.toContain('responseId')
  })

  it('跨 block 的 text delta 保留 SDK 到达顺序，completed 保留 final block 顺序', async () => {
    const { gateway, modelRef, models } = createFixture()
    const message = fauxAssistantMessage([fauxText('first block'), fauxText('second block')])
    const stream = createAssistantMessageEventStream()
    stream.push({
      type: 'text_delta',
      contentIndex: 1,
      delta: 'second delta',
      partial: message,
    })
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: 'first delta',
      partial: message,
    })
    stream.push({ type: 'done', reason: 'stop', message })
    vi.spyOn(models, 'streamSimple').mockImplementation(() => stream)

    const events = await collect(gateway.stream({ model: modelRef, messages: [], turnIndex: 2 }))
    expect(
      events.filter((event) => event.type === 'text_delta').map((event) => [event.contentIndex, event.text]),
    ).toEqual([
      [1, 'second delta'],
      [0, 'first delta'],
    ])
    const completed = events.at(-1)
    expect(completed).toMatchObject({ type: 'completed' })
    if (completed?.type === 'completed') {
      expect(completed.assistantMessage.blocks.map((block) => block.contentIndex)).toEqual([0, 1])
    }
  })

  it('丢弃原始 SDK error，只在安全错误中保留 usage/cost', async () => {
    const { faux, gateway, modelRef } = createFixture()
    faux.setResponses([
      fauxAssistantMessage(fauxText('partial secret'), {
        stopReason: 'error',
        errorMessage: 'provider raw secret',
      }),
    ])

    let thrown: unknown
    try {
      await collect(
        gateway.stream({
          model: modelRef,
          messages: [],
          turnIndex: 0,
        }),
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AiGatewayError)
    expect(thrown).toMatchObject({
      kind: 'upstream',
      code: 'upstream',
      stopReason: 'error',
      usage: expect.objectContaining({ totalTokens: expect.any(Number) }),
      cost: expect.objectContaining({ currency: 'USD', total: 0 }),
    })
    expect(JSON.stringify(thrown)).not.toContain('provider raw secret')
    expect(JSON.stringify(thrown)).not.toContain('partial secret')
    expect(String(thrown)).not.toContain('provider raw secret')
    expect(String(thrown)).not.toContain('partial secret')
    if (thrown instanceof Error) expect(thrown.cause).toBeUndefined()
  })

  it('认证解析失败映射为 auth，不保留原始错误', async () => {
    const { faux, modelRef } = createFixture()
    const models = createModels()
    models.setProvider(faux.provider)
    const gateway = createAiGateway(models, 5_000, () => {
      throw new ModelsError('auth', 'credential raw secret')
    })

    let thrown: unknown
    try {
      await collect(
        gateway.stream({
          model: modelRef,
          messages: [],
          turnIndex: 0,
        }),
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ kind: 'auth', code: 'auth' })
    expect(JSON.stringify(thrown)).not.toContain('credential raw secret')
    expect(String(thrown)).not.toContain('credential raw secret')
    if (thrown instanceof Error) expect(thrown.cause).toBeUndefined()
  })

  it('先触发的 timeout 优先于后续调用方 abort', async () => {
    const { faux, gateway, modelRef } = createFixture(5, 1)
    faux.setResponses([fauxAssistantMessage('slow answer')])
    const controller = new AbortController()
    const result = collect(
      gateway.stream({
        model: modelRef,
        messages: [],
        turnIndex: 0,
        signal: controller.signal,
      }),
    ).catch((error: unknown) => error)
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()

    expect(await result).toMatchObject({
      kind: 'timeout',
      code: 'timeout',
      usage: expect.objectContaining({ totalTokens: expect.any(Number) }),
      cost: expect.objectContaining({ currency: 'USD', total: 0 }),
      stopReason: 'aborted',
    })
  })

  it('先触发的调用方 abort 优先于后续 timeout', async () => {
    const { faux, gateway, modelRef } = createFixture(50, 1)
    faux.setResponses([fauxAssistantMessage('slow answer')])
    const controller = new AbortController()
    const promise = collect(
      gateway.stream({
        model: modelRef,
        messages: [],
        turnIndex: 0,
        signal: controller.signal,
      }),
    )
    controller.abort()

    await expect(promise).rejects.toMatchObject({
      kind: 'aborted',
      code: 'aborted',
      usage: null,
      cost: null,
      stopReason: null,
    })
  })

  it('已先取消时拒绝后续排队的 done 成功终态', async () => {
    const { gateway, modelRef, models } = createFixture()
    const controller = new AbortController()
    const message = fauxAssistantMessage('late success')
    vi.spyOn(models, 'streamSimple').mockImplementation(() => {
      const stream = createAssistantMessageEventStream()
      queueMicrotask(() => {
        controller.abort()
        stream.push({ type: 'done', reason: 'stop', message })
      })
      return stream
    })

    await expect(
      collect(
        gateway.stream({
          model: modelRef,
          messages: [],
          turnIndex: 0,
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({
      kind: 'aborted',
      usage: expect.objectContaining({ totalTokens: expect.any(Number) }),
      stopReason: 'stop',
    })
  })

  it.each([
    { stopReason: 'error' as const, expectedKind: 'upstream' },
    { stopReason: 'aborted' as const, expectedKind: 'aborted' },
    { stopReason: 'deferred' as const, expectedKind: 'upstream' },
  ])('toolcall_end 后 $stopReason 不发送工具完成事件', async ({ stopReason, expectedKind }) => {
    const { faux, gateway, modelRef } = createFixture()
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('lookup', { query: 'secret' }), {
        stopReason,
        errorMessage: stopReason === 'deferred' ? undefined : 'raw error',
        deferred:
          stopReason === 'deferred'
            ? {
                provider: modelRef.providerId,
                modelId: modelRef.modelId,
                api: 'faux',
                id: 'deferred-1',
              }
            : undefined,
      }),
    ])

    const events: AiGatewayEvent[] = []
    let thrown: unknown
    try {
      for await (const event of gateway.stream({
        model: modelRef,
        messages: [],
        turnIndex: 0,
      })) {
        events.push(event)
      }
    } catch (error) {
      thrown = error
    }

    expect(events.some((event) => event.type === 'tool_call_completed')).toBe(false)
    expect(events.some((event) => event.type === 'completed')).toBe(false)
    expect(thrown).toMatchObject({
      kind: expectedKind,
      stopReason,
      usage: expect.objectContaining({ totalTokens: expect.any(Number) }),
      cost: expect.objectContaining({ currency: 'USD', total: 0 }),
    })
  })

  it('主动取消映射为 aborted', async () => {
    const { faux, gateway, modelRef } = createFixture()
    faux.setResponses([fauxAssistantMessage('a long answer')])
    const controller = new AbortController()
    controller.abort()

    await expect(
      collect(
        gateway.stream({
          model: modelRef,
          messages: [],
          turnIndex: 0,
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ kind: 'aborted', code: 'aborted' })
  })
})
