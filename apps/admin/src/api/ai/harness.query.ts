import type {
  AgentSessionListQuery,
  AgentTranscriptQuery,
  CreateAgentSessionInput,
  UpdateAgentSessionInput,
} from '@starter/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  abortAgentRun,
  archiveAgentSession,
  createAgentSession,
  getAgentRun,
  getAgentSession,
  getAgentSessions,
  getAgentTranscript,
  updateAgentSession,
} from './harness.api'

export const harnessQueryKeys = {
  all: ['ai', 'harness'] as const,
  sessions: () => [...harnessQueryKeys.all, 'sessions'] as const,
  sessionLists: () => [...harnessQueryKeys.sessions(), 'list'] as const,
  sessionList: (query: AgentSessionListQuery) => [...harnessQueryKeys.sessionLists(), query] as const,
  sessionDetails: () => [...harnessQueryKeys.sessions(), 'detail'] as const,
  sessionDetail: (sessionId: string) => [...harnessQueryKeys.sessionDetails(), sessionId] as const,
  transcripts: (sessionId: string) => [...harnessQueryKeys.sessionDetail(sessionId), 'transcript'] as const,
  transcript: (sessionId: string, query: AgentTranscriptQuery) =>
    [...harnessQueryKeys.transcripts(sessionId), query] as const,
  runs: (sessionId: string) => [...harnessQueryKeys.sessionDetail(sessionId), 'runs'] as const,
  run: (sessionId: string, runId: string) => [...harnessQueryKeys.runs(sessionId), runId] as const,
}

export function useAgentSessionsQuery(query: AgentSessionListQuery = { page: 1, pageSize: 50 }) {
  return useQuery({
    queryKey: harnessQueryKeys.sessionList(query),
    queryFn: () => getAgentSessions(query),
  })
}

export function useAgentSessionQuery(sessionId: string | null) {
  return useQuery({
    queryKey: harnessQueryKeys.sessionDetail(sessionId ?? ''),
    queryFn: () => getAgentSession(sessionId ?? ''),
    enabled: sessionId !== null,
  })
}

export function useAgentTranscriptQuery(
  sessionId: string | null,
  query: AgentTranscriptQuery = { lane: 'main', limit: 100 },
) {
  return useQuery({
    queryKey: harnessQueryKeys.transcript(sessionId ?? '', query),
    queryFn: () => getAgentTranscript(sessionId ?? '', query),
    enabled: sessionId !== null,
  })
}

export function useAgentRunQuery(sessionId: string | null, runId: string | null) {
  return useQuery({
    queryKey: harnessQueryKeys.run(sessionId ?? '', runId ?? ''),
    queryFn: () => getAgentRun(sessionId ?? '', runId ?? ''),
    enabled: sessionId !== null && runId !== null,
  })
}

export function useCreateAgentSessionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAgentSessionInput) => createAgentSession(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: harnessQueryKeys.sessionLists() })
    },
  })
}

export function useUpdateAgentSessionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { sessionId: string; values: UpdateAgentSessionInput }) => updateAgentSession(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: harnessQueryKeys.sessionLists() }),
        queryClient.invalidateQueries({ queryKey: harnessQueryKeys.sessionDetail(input.sessionId) }),
      ])
    },
  })
}

export function useArchiveAgentSessionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => archiveAgentSession(sessionId),
    onSuccess: async (_data, sessionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: harnessQueryKeys.sessionLists() }),
        queryClient.removeQueries({ queryKey: harnessQueryKeys.sessionDetail(sessionId) }),
      ])
    },
  })
}

export function useAbortAgentRunMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { sessionId: string; runId: string }) => abortAgentRun(input.sessionId, input.runId),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({ queryKey: harnessQueryKeys.run(input.sessionId, input.runId) })
    },
  })
}
