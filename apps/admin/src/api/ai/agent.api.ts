import type {
  AgentDefinitionDetail,
  AgentDefinitionDetailList,
  AgentDefinitionListQuery,
  AgentDefinitionSummary,
  AgentDefinitionSummaryList,
  AiToolSummary,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
  UpdateAgentDefinitionStatusInput,
} from '@starter/contracts'

import { apiRpc, unwrapApiData } from '@admin/api/rpc'

export function getAgentDefinitions(
  query: AgentDefinitionListQuery = { page: 1, pageSize: 20 },
): Promise<AgentDefinitionSummaryList> {
  return unwrapApiData(
    apiRpc.api.ai.agents.$get({
      query: { page: String(query.page), pageSize: String(query.pageSize) },
    }),
  )
}

export function getAgentDefinition(agentId: string): Promise<AgentDefinitionSummary> {
  return unwrapApiData(apiRpc.api.ai.agents[':agentId'].$get({ param: { agentId } }))
}

export function getAdminAgentDefinitions(
  query: AgentDefinitionListQuery = { page: 1, pageSize: 20 },
): Promise<AgentDefinitionDetailList> {
  return unwrapApiData(
    apiRpc.api.ai.admin.agents.$get({
      query: { page: String(query.page), pageSize: String(query.pageSize) },
    }),
  )
}

export function getAdminAgentDefinition(agentId: string): Promise<AgentDefinitionDetail> {
  return unwrapApiData(apiRpc.api.ai.admin.agents[':agentId'].$get({ param: { agentId } }))
}

export function getAdminAiTools(): Promise<AiToolSummary[]> {
  return unwrapApiData(apiRpc.api.ai.admin.tools.$get())
}

export function createAgentDefinition(input: CreateAgentDefinitionInput): Promise<AgentDefinitionDetail> {
  return unwrapApiData(apiRpc.api.ai.admin.agents.$post({ json: input }))
}

export function updateAgentDefinition(input: {
  agentId: string
  values: UpdateAgentDefinitionInput
}): Promise<AgentDefinitionDetail> {
  return unwrapApiData(
    apiRpc.api.ai.admin.agents[':agentId'].$patch({
      param: { agentId: input.agentId },
      json: input.values,
    }),
  )
}

export function updateAgentDefinitionStatus(input: {
  agentId: string
  values: UpdateAgentDefinitionStatusInput
}): Promise<AgentDefinitionDetail> {
  return unwrapApiData(
    apiRpc.api.ai.admin.agents[':agentId'].status.$patch({
      param: { agentId: input.agentId },
      json: input.values,
    }),
  )
}
