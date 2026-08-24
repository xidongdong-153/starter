import type { AdminAiProvider, AiUserPreference } from '@starter/contracts'

import {
  aiQueryKeys,
  useCheckAiProviderMutation,
  useCreateCustomAiProviderMutation,
  useUpdateAiPreferenceMutation,
  useUpdateAiProviderConfigMutation,
} from '@admin/api/ai/ai.query'
import { useCreateAiApplicationMutation, useRevokeAiApplicationMutation } from '@admin/api/ai/application.query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClientWrapper, createTestQueryClient } from './helpers'

const { checkAiProvider, createCustomAiProvider, updateAiPreference, updateAiProviderConfig } = vi.hoisted(() => ({
  checkAiProvider: vi.fn(),
  createCustomAiProvider: vi.fn(),
  updateAiPreference: vi.fn(),
  updateAiProviderConfig: vi.fn(),
}))

const { createAiApplication, revokeAiApplication } = vi.hoisted(() => ({
  createAiApplication: vi.fn(),
  revokeAiApplication: vi.fn(),
}))

vi.mock('@admin/api/ai/application.api', () => ({
  createAiApplication,
  getAiApplications: vi.fn(),
  revokeAiApplication,
  rotateAiApplicationSecret: vi.fn(),
}))

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

    const created = await result.current.mutateAsync({ name: 'web-chat', tenantId: 'acme', projectId: 'chat' })

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
})
