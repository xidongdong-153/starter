import type { AdminAiProvider, AiConversationSummary, AiUserPreference } from '@starter/contracts'

import {
  aiQueryKeys,
  useCheckAiProviderMutation,
  useCreateAiConversationMutation,
  useUpdateAiPreferenceMutation,
  useUpdateAiProviderConfigMutation,
} from '@admin/api/ai/ai.query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClientWrapper, createTestQueryClient } from './helpers'

const { checkAiProvider, createAiConversation, updateAiPreference, updateAiProviderConfig } = vi.hoisted(() => ({
  checkAiProvider: vi.fn(),
  createAiConversation: vi.fn(),
  updateAiPreference: vi.fn(),
  updateAiProviderConfig: vi.fn(),
}))

vi.mock('@admin/api/ai/ai.api', () => ({
  checkAiProvider,
  clearAiProviderCredential: vi.fn(),
  createAiConversation,
  deleteAiConversation: vi.fn(),
  getAdminAiModels: vi.fn(),
  getAiConversation: vi.fn(),
  getAiConversations: vi.fn(),
  getAiModels: vi.fn(),
  getAiPreference: vi.fn(),
  getAiProviders: vi.fn(),
  refreshAiProviderModels: vi.fn(),
  stopAiConversationGeneration: vi.fn(),
  replaceAdminAiModels: vi.fn(),
  setAdminAiDefault: vi.fn(),
  setAiProviderState: vi.fn(),
  updateAiPreference,
  updateAiProviderConfig,
}))

const provider: AdminAiProvider = {
  providerId: 'openai',
  name: 'OpenAI',
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
  createAiConversation.mockReset()
  updateAiPreference.mockReset()
  updateAiProviderConfig.mockReset()
})

describe('ai query 状态', () => {
  it('会话列表使用带分页的独立 query key', () => {
    expect(aiQueryKeys.conversationList({ page: 1, pageSize: 20 })).toEqual([
      'ai',
      'conversations',
      'list',
      { page: 1, pageSize: 20 },
    ])
    expect(aiQueryKeys.conversationDetail('conversation-id')).toEqual([
      'ai',
      'conversations',
      'detail',
      'conversation-id',
    ])
  })

  it('创建会话成功后刷新列表', async () => {
    const conversation: AiConversationSummary = {
      id: '01958c80-8df7-7ce2-8f90-123456789001',
      title: '新会话',
      status: 'idle',
      activeGenerationId: null,
      lastModel: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    createAiConversation.mockResolvedValue(conversation)
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateAiConversationMutation(), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await result.current.mutateAsync({})

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: aiQueryKeys.conversationLists() }))
  })

  it('使用分离的管理员、模型和偏好 query key', () => {
    expect(aiQueryKeys.adminProviders()).toEqual(['ai', 'admin', 'providers'])
    expect(aiQueryKeys.adminModels()).toEqual(['ai', 'admin', 'models'])
    expect(aiQueryKeys.models()).toEqual(['ai', 'models'])
    expect(aiQueryKeys.preference()).toEqual(['ai', 'preference'])
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
})
