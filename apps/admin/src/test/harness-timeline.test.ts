import type { AgentRunLiveSnapshot, AgentTranscriptItem } from '@starter/contracts'
import { agentRunLiveSnapshotSchema, harnessEventSchema } from '@starter/contracts'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createEmptyHarnessStreamState, reduceHarnessEvent } from '@admin/features/ai/harness/stream-reducer'
import type { AgentTimelineItem } from '@admin/features/ai/harness/timeline'
import { fromLiveSnapshot, fromTranscript } from '@admin/features/ai/harness/timeline'

const runId = '01958c80-8df7-7ce2-8f90-123456789002'
const messageId = '01958c80-8df7-7ce2-8f90-123456789003'
const createdAt = '2026-08-18T00:00:00.000Z'

describe('fromLiveSnapshot', () => {
  it('按快照顺序转成时间线元素，保留 blocks 与用量', () => {
    const live: AgentRunLiveSnapshot = {
      lastSequence: 6,
      turn: 1,
      maxTurns: 8,
      timeline: [
        {
          kind: 'message',
          messageId,
          blocks: [
            { type: 'thinking', text: '先看需求' },
            { type: 'text', text: '结论是' },
          ],
          completed: true,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cacheWrite1hTokens: null,
            reasoningTokens: null,
            totalTokens: 15,
          },
        },
        { kind: 'tool', toolCallId: 'tool-1', name: 'read_skill', status: 'running', safeSummary: null },
        { kind: 'compaction', entryId: '01958c80-8df7-7ce2-8f90-123456789004', summary: '已压缩' },
      ],
    }

    expect(fromLiveSnapshot(live)).toEqual([
      {
        key: messageId,
        kind: 'message',
        messageId,
        blocks: [
          { type: 'thinking', text: '先看需求', blockIndex: null },
          { type: 'text', text: '结论是' },
        ],
        completed: true,
        usage: live.timeline[0]?.kind === 'message' ? live.timeline[0].usage : null,
        status: null,
        model: null,
        errorCode: null,
        createdAt: null,
      },
      {
        key: 'tool:tool-1',
        kind: 'tool',
        toolCallId: 'tool-1',
        name: 'read_skill',
        status: 'running',
        safeSummary: null,
        errorCode: null,
        createdAt: null,
      },
      {
        key: 'compaction:01958c80-8df7-7ce2-8f90-123456789004',
        kind: 'compaction',
        entryId: '01958c80-8df7-7ce2-8f90-123456789004',
        summary: '已压缩',
        tokensBefore: null,
        createdAt: null,
      },
    ])
  })
})

describe('fromTranscript', () => {
  it('四种 item 转成对应的时间线元素，顺序不变', () => {
    const items: AgentTranscriptItem[] = [
      { id: 'a1', sequence: 1, lane: 'main', createdAt, type: 'user_message', runId, content: '你好' },
      {
        id: 'a2',
        sequence: 2,
        lane: 'main',
        createdAt,
        type: 'tool_activity',
        runId,
        toolCallId: 'tool-1',
        name: 'read_skill',
        status: 'succeeded',
        errorCode: null,
        safeSummary: '完成',
      },
      {
        id: 'a3',
        sequence: 3,
        lane: 'main',
        createdAt,
        type: 'system',
        runId: null,
        kind: 'compaction',
        summary: '已压缩',
        tokensBefore: 8000,
      },
      {
        id: messageId,
        sequence: 4,
        lane: 'main',
        createdAt,
        type: 'assistant_message',
        runId,
        content: '结论是',
        blocks: [
          { type: 'thinking', text: '先看需求' },
          { type: 'text', text: '结论是' },
        ],
        status: 'completed',
        model: { providerId: 'openai', modelId: 'gpt-test' },
        stopReason: 'stop',
        errorCode: null,
      },
    ] as AgentTranscriptItem[]

    const timeline = fromTranscript(items)
    expect(timeline.map((item) => item.kind)).toEqual(['user', 'tool', 'compaction', 'message'])
    expect(timeline[2]).toMatchObject({ kind: 'compaction', tokensBefore: 8000 })
    expect(timeline[3]).toMatchObject({
      kind: 'message',
      completed: true,
      blocks: [
        { type: 'thinking', text: '先看需求', blockIndex: null },
        { type: 'text', text: '结论是' },
      ],
    })
  })

  it('assistant item 没有 blocks 时退回 content 生成单个 text 块', () => {
    const items = [
      {
        id: messageId,
        sequence: 1,
        lane: 'main',
        createdAt,
        type: 'assistant_message',
        runId,
        content: '只有 content',
        status: 'completed',
        model: { providerId: 'openai', modelId: 'gpt-test' },
        stopReason: 'stop',
        errorCode: null,
      },
    ] as AgentTranscriptItem[]

    expect(fromTranscript(items)[0]).toMatchObject({ blocks: [{ type: 'text', text: '只有 content' }] })
  })
})

// 事件与服务端快照放在仓库根的 test-fixtures/：admin 不该 import api 源码，api 也不能把
// 文件放到自己 rootDir 之外，两侧只能按路径读同一份 JSON。
// 服务端那一半断言在 apps/api/src/test/run-live-snapshot.test.ts，负责保证 fixture 里的
// liveSnapshot 就是 applyRunEvent 当前的真实输出。
const fixturePath = path.resolve(import.meta.dirname, '../../../../test-fixtures/harness-timeline-isomorphism.json')

/** 只保留跨来源可比的部分：元素类型、顺序、身份 id 和 blocks 的 type/text 序列。 */
function comparable(items: AgentTimelineItem[]) {
  return items.map((item) => {
    if (item.kind === 'message') {
      return {
        kind: item.kind,
        id: item.messageId,
        completed: item.completed,
        blocks: item.blocks.map((block) => ({ type: block.type, text: block.text })),
      }
    }
    if (item.kind === 'tool') return { kind: item.kind, id: item.toolCallId, status: item.status }
    if (item.kind === 'compaction') return { kind: item.kind, id: item.entryId, summary: item.summary }
    return { kind: item.kind, id: item.key }
  })
}

describe('流式与历史同构', () => {
  it('同一串事件在服务端快照和前端 reducer 上产出同一条时间线', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { events: unknown[]; liveSnapshot: unknown }
    const events = fixture.events.map((item) => harnessEventSchema.parse(item))
    const live = agentRunLiveSnapshotSchema.parse(fixture.liveSnapshot)

    const streamed = events.reduce((state, event) => reduceHarnessEvent(state, event), createEmptyHarnessStreamState())

    expect(comparable(fromLiveSnapshot(live))).toEqual(comparable(streamed.timeline))
    expect(streamed.lastSequence).toBe(live.lastSequence)
    expect(streamed.turn).toBe(live.turn)
    expect(streamed.maxTurns).toBe(live.maxTurns)
    // 文字与思考交错的顺序两边一致，不是各自算出来的巧合
    const kinds = comparable(streamed.timeline).map((item) => item.kind)
    expect(kinds).toEqual(['message', 'tool', 'compaction', 'message'])
    const lastBlocks = comparable(streamed.timeline).at(-1)?.blocks ?? []
    expect(lastBlocks.map((block) => block.type)).toEqual(['text', 'thinking', 'text'])
  })
})
