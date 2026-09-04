import type {
  AgentRun,
  AgentTranscript,
  AgentTranscriptQuery,
  FollowUpAgentRunInput,
  RunEvent,
  StartAgentRunInput,
  SteerAgentRunInput,
  StructuredOutputList,
} from '@starter/contracts'

import type { RuntimeAccessContext } from '../principal.js'

export interface AgentRuntimeStartInput {
  access: RuntimeAccessContext
  sessionId: string
  input: StartAgentRunInput
  requestId: string
}

export interface AgentRuntimeStartResult {
  runId: string
  events: AsyncIterable<RunEvent>
}

export type AgentRuntimeEventCursor = { afterSequence: number } | { lastEventId: string }

export interface AgentRuntimePort {
  start: (input: AgentRuntimeStartInput) => Promise<AgentRuntimeStartResult>
  get: (access: RuntimeAccessContext, sessionId: string, runId: string) => AgentRun
  active: (access: RuntimeAccessContext, sessionId: string, lane: string) => AgentRun | null
  subscribe: (
    access: RuntimeAccessContext,
    sessionId: string,
    runId: string,
    cursor: AgentRuntimeEventCursor,
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
  transcript: (
    access: RuntimeAccessContext,
    sessionId: string,
    query: AgentTranscriptQuery,
    requestId?: string,
  ) => Promise<AgentTranscript>
  outputs: (access: RuntimeAccessContext, sessionId: string, runId: string) => StructuredOutputList
}
