import type {
  AgentSessionListQuery,
  AgentTranscript,
  AgentTranscriptQuery,
  CreateAgentSessionInput,
  UpdateAgentSessionInput,
} from '@starter/contracts'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
  transcript: (sessionId: string, query: Pick<AgentTranscriptQuery, 'lane' | 'limit' | 'direction'>) =>
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

/** transcript 分页参数，cursor 由 nextCursor 驱动，不由调用方传入。 */
export type AgentTranscriptPageQuery = Pick<AgentTranscriptQuery, 'lane' | 'limit' | 'direction'>

const defaultTranscriptQuery: AgentTranscriptPageQuery = { lane: 'main', limit: 50, direction: 'backward' }

/**
 * transcript 分页查询。首屏用 `direction: 'backward'` 取最新一页（服务端返回时间正序），
 * `nextCursor` 指向更早一页，`fetchNextPage` 就是「加载更早」。
 * 页顺序是「新 -> 旧」，渲染时要倒序拼接。
 */
export function useAgentTranscriptQuery(
  sessionId: string | null,
  query: AgentTranscriptPageQuery = defaultTranscriptQuery,
) {
  return useInfiniteQuery({
    queryKey: harnessQueryKeys.transcript(sessionId ?? '', query),
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      getAgentTranscript(sessionId ?? '', { ...query, ...(pageParam === undefined ? {} : { cursor: pageParam }) }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage: AgentTranscript) => lastPage.nextCursor ?? undefined,
    enabled: sessionId !== null,
  })
}

/**
 * 单个 Run 的状态查询。`refetchInterval` 交给调用方：SSE 提前结束时页面用它轮询 `live` 快照，
 * 不传时保持一次性查询。
 */
export function useAgentRunQuery(
  sessionId: string | null,
  runId: string | null,
  options: { refetchInterval?: number | false } = {},
) {
  return useQuery({
    queryKey: harnessQueryKeys.run(sessionId ?? '', runId ?? ''),
    queryFn: () => getAgentRun(sessionId ?? '', runId ?? ''),
    enabled: sessionId !== null && runId !== null,
    refetchInterval: options.refetchInterval ?? false,
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
