import type {
  AgentRun,
  AgentTranscript,
  AgentTranscriptQuery,
  FollowUpAgentRunInput,
  RunEvent,
  SteerAgentRunInput,
  StructuredOutputList,
} from '@starter/contracts'

import type { RuntimeAccessContext } from '../principal.js'
import type {
  AgentRuntimeEventCursor,
  AgentRuntimePort,
  AgentRuntimeStartInput,
  AgentRuntimeStartResult,
} from './agent-runtime.port.js'

export interface AgentRuntimeRunBackend {
  startRun: (input: AgentRuntimeStartInput) => Promise<AgentRuntimeStartResult>
  get: (access: RuntimeAccessContext, sessionId: string, runId: string) => AgentRun
  activeRun: (access: RuntimeAccessContext, sessionId: string, lane: string) => AgentRun | null
  sequenceForEvent: (access: RuntimeAccessContext, sessionId: string, runId: string, eventId: string) => number
  subscribe: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    afterSequence: number,
  ) => AsyncIterable<RunEvent>
  abort: (access: RuntimeAccessContext, sessionId: string, runId: string) => AgentRun
  steer: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    input: SteerAgentRunInput,
  ) => Promise<AgentRun>
  followUp: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    input: FollowUpAgentRunInput,
  ) => Promise<AgentRun>
  structuredOutputs: (access: RuntimeAccessContext, sessionId: string, runId: string) => StructuredOutputList
}

export interface AgentRuntimeSessionBackend {
  transcript: (
    access: RuntimeAccessContext,
    sessionId: string,
    query: AgentTranscriptQuery,
    requestId?: string,
  ) => Promise<AgentTranscript>
}

export interface AgentRuntimeBackend {
  run: AgentRuntimeRunBackend
  session: AgentRuntimeSessionBackend
}

export function createAgentRuntimePort(backend: AgentRuntimeBackend): AgentRuntimePort {
  const { run, session } = backend

  return {
    start: (input) => run.startRun(input),
    get: (access, sessionId, runId) => run.get(access, sessionId, runId),
    active: (access, sessionId, lane) => run.activeRun(access, sessionId, lane),
    subscribe: (access, sessionId, runId, cursor) => {
      const afterSequence = resolveAfterSequence(run, access, sessionId, runId, cursor)
      return run.subscribe(access, sessionId, runId, afterSequence)
    },
    abort: (access, sessionId, runId) => run.abort(access, sessionId, runId),
    steer: (access, sessionId, runId, input) => run.steer(access, sessionId, runId, input),
    followUp: (access, sessionId, runId, input) => run.followUp(access, sessionId, runId, input),
    transcript: (access, sessionId, query, requestId) => session.transcript(access, sessionId, query, requestId),
    outputs: (access, sessionId, runId) => run.structuredOutputs(access, sessionId, runId),
  }
}

function resolveAfterSequence(
  run: AgentRuntimeRunBackend,
  access: RuntimeAccessContext,
  sessionId: string,
  runId: string,
  cursor: AgentRuntimeEventCursor,
): number {
  if ('afterSequence' in cursor) return cursor.afterSequence
  return run.sequenceForEvent(access, sessionId, runId, cursor.lastEventId)
}
