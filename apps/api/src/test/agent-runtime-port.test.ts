import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  AgentRun,
  AgentTranscript,
  FollowUpAgentRunInput,
  RunEvent,
  SteerAgentRunInput,
  StructuredOutputList,
} from '@starter/contracts'
import { expect, it } from 'vitest'

import {
  createAgentRuntimePort,
  type AgentRuntimeBackend,
  type AgentRuntimeRunBackend,
  type AgentRuntimeSessionBackend,
  type AgentRuntimeStartInput,
  type AgentRuntimeStartResult,
} from '@api/modules/ai/runtime/index.js'
import { starterRuntimeAccess } from '@api/modules/ai/principal.js'

const access = starterRuntimeAccess('user-1')
const run = {} as AgentRun
const transcript: AgentTranscript = { items: [], nextCursor: null }
const outputs: StructuredOutputList = { items: [] }
const events = emptyEvents()
const startInput: AgentRuntimeStartInput = {
  access,
  sessionId: 'session-1',
  input: { input: 'hello' },
  requestId: 'request-1',
}
const startResult: AgentRuntimeStartResult = { runId: 'run-1', events }

it('adapter 把运行和 transcript 方法映射到窄 port，并只在 lastEventId 入口解析 sequence', async () => {
  let started: AgentRuntimeStartInput | undefined
  let got: [typeof access, string, string] | undefined
  let active: [typeof access, string, string] | undefined
  let subscribedAfter: number | undefined
  let sequencedEventId: string | undefined
  let aborted: [typeof access, string, string] | undefined
  let steered: SteerAgentRunInput | undefined
  let followedUp: FollowUpAgentRunInput | undefined
  let transcriptRequestId: string | undefined
  let outputRunId: string | undefined

  const runBackend: AgentRuntimeRunBackend = {
    startRun: async (input) => {
      started = input
      return startResult
    },
    get: (currentAccess, sessionId, runId) => {
      got = [currentAccess, sessionId, runId]
      return run
    },
    activeRun: (currentAccess, sessionId, lane) => {
      active = [currentAccess, sessionId, lane]
      return run
    },
    sequenceForEvent: (_currentAccess, _sessionId, _runId, eventId) => {
      sequencedEventId = eventId
      return 12
    },
    subscribe: (_currentAccess, _sessionId, _runId, afterSequence) => {
      subscribedAfter = afterSequence
      return events
    },
    abort: (currentAccess, sessionId, runId) => {
      aborted = [currentAccess, sessionId, runId]
      return run
    },
    steer: async (_currentAccess, _sessionId, _runId, input) => {
      steered = input
      return run
    },
    followUp: async (_currentAccess, _sessionId, _runId, input) => {
      followedUp = input
      return run
    },
    structuredOutputs: (_currentAccess, _sessionId, runId) => {
      outputRunId = runId
      return outputs
    },
  }
  const sessionBackend: AgentRuntimeSessionBackend = {
    transcript: async (_currentAccess, _sessionId, _query, requestId) => {
      transcriptRequestId = requestId
      return transcript
    },
  }
  const backend: AgentRuntimeBackend = { run: runBackend, session: sessionBackend }
  const port = createAgentRuntimePort(backend)

  expect(await port.start(startInput)).toBe(startResult)
  expect(started).toBe(startInput)
  expect(port.get(access, 'session-1', 'run-1')).toBe(run)
  expect(got).toEqual([access, 'session-1', 'run-1'])
  expect(port.active(access, 'session-1', 'review')).toBe(run)
  expect(active).toEqual([access, 'session-1', 'review'])

  expect(port.subscribe(access, 'session-1', 'run-1', { afterSequence: 7 })).toBe(events)
  expect(subscribedAfter).toBe(7)
  expect(sequencedEventId).toBeUndefined()

  expect(port.subscribe(access, 'session-1', 'run-1', { lastEventId: 'event-1' })).toBe(events)
  expect(sequencedEventId).toBe('event-1')
  expect(subscribedAfter).toBe(12)

  expect(port.abort(access, 'session-1', 'run-1')).toBe(run)
  expect(aborted).toEqual([access, 'session-1', 'run-1'])
  expect(await port.steer(access, 'session-1', 'run-1', { text: 'steer' })).toBe(run)
  expect(steered).toEqual({ text: 'steer' })
  expect(await port.followUp(access, 'session-1', 'run-1', { text: 'follow up' })).toBe(run)
  expect(followedUp).toEqual({ text: 'follow up' })
  expect(
    await port.transcript(access, 'session-1', { lane: 'main', direction: 'backward', limit: 20 }, 'request-2'),
  ).toBe(transcript)
  expect(transcriptRequestId).toBe('request-2')
  expect(port.outputs(access, 'session-1', 'run-1')).toBe(outputs)
  expect(outputRunId).toBe('run-1')
})

it('agentRuntimePort 文件不依赖 HTTP、repository、Pi 或 concrete service return type', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../modules/ai/runtime/agent-runtime.port.ts'), 'utf8')
  expect(source).not.toMatch(/hono|repository|pi-|ReturnType|createAiAgentRunService/i)
  expect(source).not.toContain('sequenceForEvent')
})

async function* emptyEvents(): AsyncGenerator<RunEvent> {}
