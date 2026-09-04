import type { AdminAiProvider, AiUserPreference } from '@starter/contracts'

import {
  aiQueryKeys,
  useCheckAiProviderMutation,
  useCreateCustomAiProviderMutation,
  useUpdateAiPreferenceMutation,
  useUpdateAiProviderConfigMutation,
} from '@admin/api/ai/ai.query'
import { fetchAllEnabledAgentDefinitions } from '@admin/api/ai/agent.query'
import {
  useCreateAiApplicationMutation,
  useRevokeAiApplicationMutation,
  useUpdateAiApplicationPolicyMutation,
} from '@admin/api/ai/application.query'
import { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClientWrapper, createTestQueryClient } from './helpers'

const { checkAiProvider, createCustomAiProvider, updateAiPreference, updateAiProviderConfig } = vi.hoisted(() => ({
  checkAiProvider: vi.fn(),
  createCustomAiProvider: vi.fn(),
  updateAiPreference: vi.fn(),
  updateAiProviderConfig: vi.fn(),
}))

const { createAiApplication, revokeAiApplication, updateAiApplicationPolicy } = vi.hoisted(() => ({
  createAiApplication: vi.fn(),
  revokeAiApplication: vi.fn(),
  updateAiApplicationPolicy: vi.fn(),
}))

const { getAgentDefinitions } = vi.hoisted(() => ({
  getAgentDefinitions: vi.fn(),
}))

vi.mock('@admin/api/ai/application.api', () => ({
  createAiApplication,
  getAiApplications: vi.fn(),
  revokeAiApplication,
  rotateAiApplicationSecret: vi.fn(),
  updateAiApplicationPolicy,
}))

vi.mock('@admin/api/ai/agent.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@admin/api/ai/agent.api')>()
  return { ...actual, getAgentDefinitions }
})

vi.mock('@admin/api/ai/ai.api', () => ({
  checkAiProvider,
  clearAiProviderCredential: vi.fn(),
  createCustomAiProvider,
  getAdminAiModels: vi.fn(),
  getAiModels: vi.fn(),
  getAiPreference: vi.fn(),
  getAiProviders: vi.fn(),
  refreshAiProviderModels: vi.fn(),
  replaceAdminAiModels: vi.fn(),
  setAdminAiDefault: vi.fn(),
  setAiProviderState: vi.fn(),
  updateAiPreference,
  updateAiProviderConfig,
  updateCustomAiProvider: vi.fn(),
}))

const provider: AdminAiProvider = {
  providerId: 'openai',
  name: 'OpenAI',
  kind: 'built_in',
  protocol: null,
  baseUrl: null,
  revision: 0,
  enabled: false,
  supportedAuthModes: ['api_key', 'ambient'],
  activeCredentialType: 'api_key',
  authStatus: 'needs_check',
  authSource: null,
  checkedAt: null,
  credentialMask: '****test',
  configFields: [],
  configuredSettings: {},
  setupInstructions: [],
  supportsModelRefresh: false,
  catalogModelCount: 1,
  enabledModelCount: 0,
  configRevision: 1,
}

beforeEach(() => {
  checkAiProvider.mockReset()
  createCustomAiProvider.mockReset()
  updateAiPreference.mockReset()
  updateAiProviderConfig.mockReset()
  createAiApplication.mockReset()
  revokeAiApplication.mockReset()
  updateAiApplicationPolicy.mockReset()
  getAgentDefinitions.mockReset()
})

describe('ai query 状态', () => {
  it('使用分离的管理员、模型和偏好 query key', () => {
    expect(aiQueryKeys.adminProviders()).toEqual(['ai', 'admin', 'providers'])
    expect(aiQueryKeys.adminModels()).toEqual(['ai', 'admin', 'models'])
    expect(aiQueryKeys.applications()).toEqual(['ai', 'admin', 'applications'])
    expect(aiQueryKeys.models()).toEqual(['ai', 'models'])
    expect(aiQueryKeys.preference()).toEqual(['ai', 'preference'])
  })

  it('自定义 Provider 创建成功后失效 Provider、模型和偏好查询', async () => {
    createCustomAiProvider.mockResolvedValue({})
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateCustomAiProviderMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await result.current.mutateAsync({
      providerId: 'custom-provider',
      name: 'Custom Provider',
      baseUrl: 'https://api.example.com',
      protocol: 'openai-completions',
      compat: {},
      models: [
        {
          modelId: 'model',
          name: 'Model',
          contextWindow: 1,
          maxOutputTokens: 1,
          supportsImageInput: false,
          supportsReasoning: false,
          supportsTools: false,
          inputCost: 0,
          outputCost: 0,
          cacheReadCost: 0,
          cacheWriteCost: 0,
        },
      ],
    })

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(5))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.customProviders() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.preference() })
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0))
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain('secret-value')
  })
  it('provider 配置成功后失效管理员和用户 AI 查询', async () => {
    updateAiProviderConfig.mockResolvedValue(provider)
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateAiProviderConfigMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await result.current.mutateAsync({ providerId: 'openai', values: { apiKey: 'secret', settings: {} } })

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(4))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.adminProviders() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.adminModels() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.models() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.preference() })
  })

  it('provider 配置失败时不失效查询', async () => {
    updateAiProviderConfig.mockRejectedValue(new Error('409'))
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateAiProviderConfigMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await expect(
      result.current.mutateAsync({ providerId: 'openai', values: { apiKey: 'secret', settings: {} } }),
    ).rejects.toThrow('409')
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('认证检查失败后仍刷新已落库的 provider 状态', async () => {
    checkAiProvider.mockRejectedValue(new Error('auth failed'))
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCheckAiProviderMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await expect(result.current.mutateAsync('openai')).rejects.toThrow('auth failed')
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(4))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.adminProviders() })
  })

  it('偏好更新只失效偏好和用户模型', async () => {
    const preference: AiUserPreference = {
      selectedModel: null,
      effectiveModel: null,
      effectiveSource: null,
    }
    updateAiPreference.mockResolvedValue(preference)
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateAiPreferenceMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await result.current.mutateAsync(null)

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.preference() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.models() })
  })

  it('创建应用只失效应用列表，secret 不进 query cache', async () => {
    createAiApplication.mockResolvedValue({
      application: { appId: 'app-1', name: 'web-chat' },
      secret: 'ai_secret_value',
    })
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateAiApplicationMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    const created = await result.current.mutateAsync({
      name: 'web-chat',
      tenantId: 'acme',
      projectId: 'chat',
      policy: { schemaVersion: 1, executables: [], controls: [], maxSideEffect: 'read_only' },
    })

    expect(created.secret).toBe('ai_secret_value')
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.applications() })
    const cached = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data)
    expect(JSON.stringify(cached)).not.toContain('ai_secret_value')
  })

  it('撤销应用失败时不失效列表', async () => {
    revokeAiApplication.mockRejectedValue(new Error('409'))
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useRevokeAiApplicationMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await expect(result.current.mutateAsync('app-1')).rejects.toThrow('409')
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('更新应用策略成功后失效应用列表', async () => {
    updateAiApplicationPolicy.mockResolvedValue({ appId: 'app-1' })
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateAiApplicationPolicyMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await result.current.mutateAsync({
      appId: 'app-1',
      values: { policy: { schemaVersion: 1, executables: [], controls: [], maxSideEffect: 'read_only' } },
    })

    expect(updateAiApplicationPolicy).toHaveBeenCalledWith('app-1', {
      policy: { schemaVersion: 1, executables: [], controls: [], maxSideEffect: 'read_only' },
    })
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.applications() })
  })
})

describe('fetchAllEnabledAgentDefinitions', () => {
  const agentAt = (index: number) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `agent-${index}`,
    description: '',
    status: 'enabled',
    revision: 1,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  })

  const pageOf = (page: number, count: number) => ({
    items: Array.from({ length: count }, (_, index) => agentAt((page - 1) * 100 + index)),
    total: page * 100,
    page,
    pageSize: 100,
  })

  it('单页装得下时只拉一次', async () => {
    getAgentDefinitions.mockResolvedValue(pageOf(1, 30))
    const agents = await fetchAllEnabledAgentDefinitions(new QueryClient())

    expect(agents).toHaveLength(30)
    expect(getAgentDefinitions).toHaveBeenCalledTimes(1)
    expect(getAgentDefinitions).toHaveBeenCalledWith({ page: 1, pageSize: 100 })
  })

  it('超过一页时循环分页拉完全部启用 Agent，某页不满即终止', async () => {
    getAgentDefinitions.mockImplementation(async (query: { page: number }) =>
      query.page === 1 ? pageOf(1, 100) : pageOf(2, 50),
    )
    const agents = await fetchAllEnabledAgentDefinitions(new QueryClient())

    expect(agents).toHaveLength(150)
    expect(getAgentDefinitions).toHaveBeenCalledTimes(2)
    expect(getAgentDefinitions).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100 })
  })

  it('达到 20 页安全上限后停止拉取并告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getAgentDefinitions.mockImplementation(async (query: { page: number }) => pageOf(query.page, 100))
    try {
      const agents = await fetchAllEnabledAgentDefinitions(new QueryClient())

      expect(agents).toHaveLength(2000)
      expect(getAgentDefinitions).toHaveBeenCalledTimes(20)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})
