import { describe, expect, it, vi } from 'vitest'
import type { RunEvent } from '@starter/contracts'
import { createAiRunEventRepository } from '@api/modules/ai/run/run-event.repository.js'
import {
  RUN_EVENT_MERGE_MAX_BYTES,
  RUN_EVENT_MERGE_WINDOW_MS,
  RunEventPublisher,
} from '@api/modules/ai/run/run-event.publisher.js'
import { AsyncEventQueue } from '@api/infra/agent/pi-event-mapper.js'
import { createTestApp } from './helpers.js'

const runId = '01958c80-8df7-7ce2-8f90-123456789001'
const sessionId = '01958c80-8df7-7ce2-8f90-123456789002'
const agentId = '01958c80-8df7-7ce2-8f90-123456789003'

function seedRun(runtime: ReturnType<typeof createTestApp>['runtime']) {
  const now = Date.now()
  runtime.database.sqlite
    .prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('user-1', 'User', 'user@example.com', 0, now, now)
  runtime.database.sqlite
    .prepare(
      `INSERT INTO ai_agent_definitions (id, name, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(agentId, 'Agent', '{"schemaVersion":2}', now, now)
  runtime.database.sqlite
    .prepare(
      `INSERT INTO ai_agent_sessions (id, owner_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, 'user-1', 'Session', now, now)
  runtime.database.sqlite
    .prepare(
      `INSERT INTO ai_agent_runs
       (id, session_id, agent_id, lane, status, agent_revision, snapshot_json, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, sessionId, agentId, 'main', 'running', 1, '{"schemaVersion":2}', 'request-1', now)
}

function eventBase() {
  return {
    runId,
    sessionId,
    lane: 'main' as const,
    turnIndex: null,
    stepId: null,
    modelCallId: null,
    messageId: null,
    toolCallId: null,
    toolExecutionId: null,
  }
}

describe('runEvent Publisher', () => {
  it('写库后才入队，并为同一 Run 分配连续 sequence', async () => {
    const test = createTestApp()
    try {
      seedRun(test.runtime)
      const queue = new AsyncEventQueue<never>()
      const repository = createAiRunEventRepository(test.runtime.db)
      const publisher = new RunEventPublisher({
        repository,
        queue: queue as never,
      })
      const base = {
        runId,
        sessionId,
        lane: 'main' as const,
        turnIndex: null,
        stepId: null,
        modelCallId: null,
        messageId: null,
        toolCallId: null,
        toolExecutionId: null,
      }
      const first = publisher.publish({
        ...base,
        type: 'run.started',
        data: {
          agentId,
          agentRevision: 1,
          model: { providerId: 'openai', modelId: 'gpt-4o' },
          outputContract: null,
        },
      })
      const second = publisher.publish({
        ...base,
        type: 'turn.started',
        data: { stepLimit: 8 },
      })

      expect(first?.sequence).toBe(1)
      expect(second?.sequence).toBe(2)
      expect(repository.watermark(runId)).toBe(2)
      expect(repository.listAfter(runId, 0, 10).map((event) => event.sequence)).toEqual([1, 2])
      expect(repository.findSequenceByEventId(runId, first?.eventId ?? '')).toBe(1)
    } finally {
      test.cleanup()
    }
  })

  it('message delta 按 1KB 上限合并，非合并事件先刷缓冲', () => {
    const test = createTestApp()
    try {
      seedRun(test.runtime)
      const repository = createAiRunEventRepository(test.runtime.db)
      const published: RunEvent[] = []
      const publisher = new RunEventPublisher({
        repository,
        sink: { push: (event) => published.push(event) },
      })
      const messageId = '01958c80-8df7-7ce2-8f90-1234567890b1'
      const chunk = 'x'.repeat(64)
      const chunkCount = 40
      for (let index = 0; index < chunkCount; index += 1) {
        expect(
          publisher.publish({
            ...eventBase(),
            messageId,
            type: 'message.delta',
            data: { partId: messageId, delta: chunk },
          }),
        ).toBeNull()
      }
      // 攒到 1KB 才落库，还没到上限的尾段留在缓冲里
      const merged = published.filter((event) => event.type === 'message.delta')
      expect(merged.length).toBe(Math.floor((chunk.length * chunkCount) / RUN_EVENT_MERGE_MAX_BYTES))

      // message.completed 是非合并事件，会先把缓冲刷出来
      const completed = publisher.publish({
        ...eventBase(),
        messageId,
        type: 'message.completed',
        data: {
          role: 'assistant',
          content: chunk.repeat(chunkCount),
          stopReason: 'stop',
        },
      })
      const types = published.map((event) => event.type)
      expect(types.at(-1)).toBe('message.completed')
      expect(types.at(-2)).toBe('message.delta')
      expect(published.map((event) => event.sequence)).toEqual(published.map((_event, index) => index + 1))
      expect(
        published
          .filter((event) => event.type === 'message.delta')
          .map((event) => (event.data as { delta: string }).delta)
          .join(''),
      ).toBe(chunk.repeat(chunkCount))
      expect(completed?.sequence).toBe(published.length)
      expect(repository.listAfter(runId, 0, 100)).toHaveLength(published.length)
    } finally {
      test.cleanup()
    }
  })

  it('250ms 窗口到点自动落库，close 之后不再留定时器', () => {
    vi.useFakeTimers()
    const test = createTestApp()
    try {
      seedRun(test.runtime)
      const repository = createAiRunEventRepository(test.runtime.db)
      const published: RunEvent[] = []
      const publisher = new RunEventPublisher({
        repository,
        sink: { push: (event) => published.push(event) },
      })
      const messageId = '01958c80-8df7-7ce2-8f90-1234567890b2'
      publisher.publish({
        ...eventBase(),
        messageId,
        type: 'message.delta',
        data: { partId: messageId, delta: 'a' },
      })
      expect(published).toHaveLength(0)
      vi.advanceTimersByTime(RUN_EVENT_MERGE_WINDOW_MS)
      expect(published.map((event) => event.type)).toEqual(['message.delta'])

      // close 丢弃未落库的缓冲，不留悬挂 timer
      publisher.publish({
        ...eventBase(),
        messageId,
        type: 'message.delta',
        data: { partId: messageId, delta: 'b' },
      })
      publisher.close()
      vi.advanceTimersByTime(RUN_EVENT_MERGE_WINDOW_MS * 4)
      expect(published).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      test.cleanup()
      vi.useRealTimers()
    }
  })

  it('tool progress 合并成最新状态，切换合并键先刷旧缓冲', () => {
    const test = createTestApp()
    try {
      seedRun(test.runtime)
      const repository = createAiRunEventRepository(test.runtime.db)
      const published: RunEvent[] = []
      const publisher = new RunEventPublisher({
        repository,
        sink: { push: (event) => published.push(event) },
      })
      for (const summary of ['step 1', 'step 2', 'step 3']) {
        publisher.publish({
          ...eventBase(),
          toolCallId: 'tool-call-1',
          type: 'tool.progress',
          data: { summary, state: 'running' },
        })
      }
      // 换成另一个 toolCallId：旧缓冲先落库
      publisher.publish({
        ...eventBase(),
        toolCallId: 'tool-call-2',
        type: 'tool.progress',
        data: { summary: 'other tool', state: 'running' },
      })
      publisher.flush()

      const progress = published.filter((event) => event.type === 'tool.progress')
      expect(progress.map((event) => [event.toolCallId, (event.data as { summary: string }).summary])).toEqual([
        ['tool-call-1', 'step 3'],
        ['tool-call-2', 'other tool'],
      ])
      expect(repository.listAfter(runId, 0, 100)).toHaveLength(2)
    } finally {
      test.cleanup()
    }
  })

  it('写库失败时不入队、不再发布后续事件，并上报存储失败', () => {
    const test = createTestApp()
    try {
      seedRun(test.runtime)
      const repository = createAiRunEventRepository(test.runtime.db)
      const published: RunEvent[] = []
      const failures: unknown[] = []
      const publisher = new RunEventPublisher({
        repository: {
          ...repository,
          append: (draft) => {
            if (draft.type === 'turn.completed') throw new Error('append 失败')
            return repository.append(draft)
          },
        },
        sink: { push: (event) => published.push(event) },
        onStorageFailure: (error) => failures.push(error),
      })
      publisher.publish({
        ...eventBase(),
        type: 'turn.started',
        data: { stepLimit: 8 },
      })
      expect(() =>
        publisher.publish({
          ...eventBase(),
          type: 'turn.completed',
          data: { stepCount: 1, toolCount: 0, outcome: 'succeeded' },
        }),
      ).toThrow('append 失败')
      expect(failures).toHaveLength(1)
      // 失败之后不再发布任何事件，避免 sequence 空洞
      expect(
        publisher.publish({
          ...eventBase(),
          type: 'turn.started',
          data: { stepLimit: 8 },
        }),
      ).toBeNull()
      expect(published.map((event) => event.type)).toEqual(['turn.started'])
      expect(repository.listAfter(runId, 0, 100).map((e) => e.sequence)).toEqual([1])
    } finally {
      test.cleanup()
    }
  })
})
