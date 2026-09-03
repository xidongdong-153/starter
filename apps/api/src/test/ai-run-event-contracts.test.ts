import { runEventSchema, runTimelineQuerySchema, runTimelineSchema, runTraceSchema } from '@starter/contracts'
import { describe, expect, it } from 'vitest'

const ids = {
  run: '01958c80-8df7-7ce2-8f90-123456789001',
  session: '01958c80-8df7-7ce2-8f90-123456789002',
  step: '01958c80-8df7-7ce2-8f90-123456789003',
  model: '01958c80-8df7-7ce2-8f90-123456789004',
  message: '01958c80-8df7-7ce2-8f90-123456789005',
  execution: '01958c80-8df7-7ce2-8f90-123456789006',
  entry: '01958c80-8df7-7ce2-8f90-123456789007',
}

const base = {
  eventId: ids.entry,
  sequence: 1,
  occurredAt: '2025-01-01T00:00:00.000Z',
  runId: ids.run,
  sessionId: ids.session,
  lane: 'main',
  turnIndex: 1,
  stepId: ids.step,
  modelCallId: ids.model,
  messageId: ids.message,
  toolCallId: 'call-1',
  toolExecutionId: ids.execution,
}

const event = (type: string, data: object) => ({ ...base, type, data })

describe('runEvent contract', () => {
  it('解析完整事件族并保留统一关联 envelope', () => {
    const events = [
      event('run.started', {
        agentId: ids.step,
        agentRevision: 2,
        model: { providerId: 'openai', modelId: 'gpt-4o' },
        outputContract: null,
      }),
      event('turn.started', { stepLimit: 8 }),
      event('step.started', { kind: 'assistant', attempt: 1 }),
      event('model_call.started', {
        providerId: 'openai',
        modelId: 'gpt-4o',
        api: 'chat',
        streaming: true,
      }),
      event('model_call.first_output', { elapsedMs: 120 }),
      event('message.started', {
        role: 'assistant',
        partPolicy: 'text_and_thinking',
      }),
      event('thinking.started', { blockIndex: 0, display: true }),
      event('thinking.delta', { blockIndex: 0, delta: '先检查' }),
      event('thinking.completed', {
        blockIndex: 0,
        display: true,
        summary: '已完成检查',
      }),
      event('message.delta', { partId: 'part-1', delta: '结果' }),
      event('message.completed', {
        role: 'assistant',
        content: '结果',
        stopReason: 'stop',
      }),
      event('tool.started', { name: 'lookup', version: '1.0.0' }),
      event('tool.progress', { summary: '已读取 1 页', state: 'running' }),
      event('tool.completed', {
        name: 'lookup',
        version: '1.0.0',
        status: 'succeeded',
        summary: '完成',
        entryId: ids.entry,
        error: null,
      }),
      event('model_call.completed', {
        responseModel: 'gpt-4o',
        responseId: 'resp-1',
        stopReason: 'stop',
        usage: null,
        cost: null,
      }),
      event('step.completed', {
        kind: 'assistant',
        attempt: 1,
        outcome: 'succeeded',
        error: null,
      }),
      event('turn.completed', {
        stepCount: 1,
        toolCount: 1,
        outcome: 'succeeded',
      }),
      event('context.compacted', {
        entryId: ids.entry,
        tokensBefore: 1000,
        summary: '压缩完成',
      }),
      event('structured_output.available', {
        contract: {
          name: 'plan',
          version: '1.0.0',
          schemaHash: 'a'.repeat(64),
          renderKind: 'plan',
          visibility: 'product',
          mode: 'required',
        },
        value: { title: '计划' },
        referenceId: null,
      }),
      event('source.available', {
        sourceId: 'source-1',
        kind: 'document',
        title: '文档',
        uri: 'https://example.com/doc',
        excerpt: '摘要',
      }),
      event('run.completed', {
        finalEntryId: ids.entry,
        reason: 'structured_output',
      }),
      event('run.failed', {
        finalEntryId: null,
        error: {
          code: 'AI.UPSTREAM_ERROR',
          category: 'upstream',
          retryable: true,
        },
      }),
      event('run.aborted', { code: 'AI.REQUEST_ABORTED' }),
      event('model_call.failed', {
        error: {
          code: 'AI.UPSTREAM_ERROR',
          category: 'upstream',
          retryable: true,
        },
      }),
    ]

    for (const item of events) {
      const parsed = runEventSchema.parse(item)
      expect(parsed.runId).toBe(ids.run)
      expect(parsed.turnIndex).toBe(1)
      expect(parsed.stepId).toBe(ids.step)
    }
  })

  it('拒绝协议外字段和不安全数据', () => {
    expect(
      runEventSchema.safeParse({
        ...event('message.delta', { partId: 'part-1', delta: 'x' }),
        version: 1,
      }).success,
    ).toBe(false)
    expect(
      runEventSchema.safeParse({
        ...event('tool.progress', { summary: 'x', state: 'running' }),
        data: { summary: 'x', state: 'running', arguments: { secret: true } },
      }).success,
    ).toBe(false)
    expect(
      runEventSchema.safeParse({
        ...event('run.aborted', { code: 'AI.REQUEST_ABORTED' }),
        toolExecutionId: null,
        stepId: 'not-a-uuid',
      }).success,
    ).toBe(false)
    expect(
      runEventSchema.safeParse(
        event('structured_output.available', {
          contract: {
            name: 'plan',
            version: '1.0.0',
            schemaHash: 'bad',
            renderKind: 'plan',
            visibility: 'product',
            mode: 'required',
          },
          value: {},
          referenceId: null,
        }),
      ).success,
    ).toBe(false)
  })

  it('校验 Timeline 分页和 Trace 关联', () => {
    expect(runTimelineQuerySchema.parse({ afterSequence: '2', pageSize: '20' })).toEqual({
      afterSequence: 2,
      pageSize: 20,
    })
    const parsedEvent = runEventSchema.parse(
      event('run.started', {
        agentId: ids.step,
        agentRevision: 1,
        model: { providerId: 'openai', modelId: 'gpt-4o' },
        outputContract: null,
      }),
    )
    expect(
      runTimelineSchema.parse({
        items: [parsedEvent],
        afterSequence: 0,
        nextSequence: 1,
        hasMore: true,
      }).items,
    ).toHaveLength(1)
    expect(
      runTraceSchema.parse({
        runId: ids.run,
        attempts: [
          {
            attemptNo: 1,
            trigger: 'initial',
            status: 'succeeded',
            errorCode: null,
            startedAt: base.occurredAt,
            finishedAt: base.occurredAt,
          },
        ],
        nodes: [
          {
            id: ids.run,
            parentId: null,
            kind: 'run',
            status: 'succeeded',
            startedAt: base.occurredAt,
            finishedAt: base.occurredAt,
            durationMs: 1,
            error: null,
            attributes: { sessionId: ids.session },
          },
          {
            id: ids.step,
            parentId: ids.run,
            kind: 'step',
            status: 'succeeded',
            startedAt: base.occurredAt,
            finishedAt: base.occurredAt,
            durationMs: 1,
            error: null,
            attributes: { attempt: '1' },
          },
        ],
      }).nodes[1]?.parentId,
    ).toBe(ids.run)
    expect(
      runTraceSchema.safeParse({
        runId: ids.run,
        nodes: [],
        attempts: [
          {
            attemptNo: 2,
            trigger: 'auto_retry',
            status: 'failed',
            errorCode: 'AI.UPSTREAM_ERROR',
            startedAt: base.occurredAt,
            finishedAt: null,
          },
        ],
      }).success,
    ).toBe(true)
  })
})
