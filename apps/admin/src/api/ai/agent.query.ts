import type {
  AgentDefinitionListQuery,
  AgentDefinitionSummary,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
  UpdateAgentDefinitionStatusInput,
} from '@starter/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import {
  createAgentDefinition,
  getAdminAgentDefinition,
  getAdminAgentDefinitions,
  getAdminAiTools,
  getAgentDefinition,
  getAgentDefinitions,
  updateAgentDefinition,
  updateAgentDefinitionStatus,
} from './agent.api'

export const agentQueryKeys = {
  all: ['ai', 'agents'] as const,
  admin: () => [...agentQueryKeys.all, 'admin'] as const,
  lists: () => [...agentQueryKeys.admin(), 'list'] as const,
  list: (query: AgentDefinitionListQuery) => [...agentQueryKeys.lists(), query] as const,
  details: () => [...agentQueryKeys.admin(), 'detail'] as const,
  detail: (agentId: string) => [...agentQueryKeys.details(), agentId] as const,
  public: () => [...agentQueryKeys.all, 'public'] as const,
  publicLists: () => [...agentQueryKeys.public(), 'list'] as const,
  publicList: (query: AgentDefinitionListQuery) => [...agentQueryKeys.publicLists(), query] as const,
  publicDetails: () => [...agentQueryKeys.public(), 'detail'] as const,
  publicDetail: (agentId: string) => [...agentQueryKeys.publicDetails(), agentId] as const,
  tools: () => [...agentQueryKeys.admin(), 'tools'] as const,
}

export function useAgentDefinitionsQuery(query: AgentDefinitionListQuery = { page: 1, pageSize: 20 }) {
  return useQuery({
    queryKey: agentQueryKeys.publicList(query),
    queryFn: () => getAgentDefinitions(query),
  })
}

/** 单次全量拉取的页数上限：20 页 x 100 条 = 2000 条，超出停止并告警。 */
const MAX_FETCH_PAGES = 20
const AGENT_FETCH_PAGE_SIZE = 100

/**
 * 循环分页拉取全部启用 Agent。pageSize 100 是公开协议上限，不为 admin 放宽；
 * 某页条数不足一页即终止。结果按页缓存进 React Query，与既有分页 key 不冲突。
 */
export async function fetchAllEnabledAgentDefinitions(queryClient: QueryClient): Promise<AgentDefinitionSummary[]> {
  const agents: AgentDefinitionSummary[] = []
  for (let page = 1; page <= MAX_FETCH_PAGES; page += 1) {
    const query: AgentDefinitionListQuery = { page, pageSize: AGENT_FETCH_PAGE_SIZE }
    const result = await queryClient.fetchQuery({
      queryKey: agentQueryKeys.publicList(query),
      queryFn: () => getAgentDefinitions(query),
    })
    agents.push(...result.items)
    if (result.items.length < AGENT_FETCH_PAGE_SIZE) return agents
  }
  console.warn(
    `启用 Agent 超过 ${MAX_FETCH_PAGES * AGENT_FETCH_PAGE_SIZE} 条，策略选择器只展示前 ${MAX_FETCH_PAGES * AGENT_FETCH_PAGE_SIZE} 条`,
  )
  return agents
}

export function useAgentDefinitionQuery(agentId: string | null) {
  return useQuery({
    queryKey: agentQueryKeys.publicDetail(agentId ?? ''),
    queryFn: () => getAgentDefinition(agentId ?? ''),
    enabled: agentId !== null,
  })
}

export function useAdminAgentDefinitionsQuery(query: AgentDefinitionListQuery = { page: 1, pageSize: 20 }) {
  return useQuery({
    queryKey: agentQueryKeys.list(query),
    queryFn: () => getAdminAgentDefinitions(query),
  })
}

export function useAdminAgentDefinitionQuery(agentId: string | null) {
  return useQuery({
    queryKey: agentQueryKeys.detail(agentId ?? ''),
    queryFn: () => getAdminAgentDefinition(agentId ?? ''),
    enabled: agentId !== null,
  })
}

export function useAdminAiToolsQuery() {
  return useQuery({
    queryKey: agentQueryKeys.tools(),
    queryFn: getAdminAiTools,
  })
}

async function invalidateAgentDefinitions(queryClient: ReturnType<typeof useQueryClient>, agentId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: agentQueryKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: agentQueryKeys.publicLists() }),
    ...(agentId
      ? [
          queryClient.invalidateQueries({ queryKey: agentQueryKeys.detail(agentId) }),
          queryClient.invalidateQueries({ queryKey: agentQueryKeys.publicDetail(agentId) }),
        ]
      : []),
  ])
}

export function useCreateAgentDefinitionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAgentDefinitionInput) => createAgentDefinition(input),
    onSuccess: () => invalidateAgentDefinitions(queryClient),
  })
}

export function useUpdateAgentDefinitionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { agentId: string; values: UpdateAgentDefinitionInput }) => updateAgentDefinition(input),
    onSuccess: (_data, input) => invalidateAgentDefinitions(queryClient, input.agentId),
  })
}

export function useUpdateAgentDefinitionStatusMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { agentId: string; values: UpdateAgentDefinitionStatusInput }) =>
      updateAgentDefinitionStatus(input),
    onSuccess: (_data, input) => invalidateAgentDefinitions(queryClient, input.agentId),
  })
}
