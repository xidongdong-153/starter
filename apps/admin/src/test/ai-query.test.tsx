import type { AdminAiProvider, AiUserPreference } from '@starter/contracts'

import {
  aiQueryKeys,
  useCheckAiProviderMutation,
  useUpdateAiPreferenceMutation,
  useUpdateAiProviderConfigMutation,
} from '@admin/api/ai/ai.query'
import { useAgentRunQuery, useAgentTranscriptQuery } from '@admin/api/ai/harness.query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClientWrapper, createTestQueryClient } from './helpers'

const { checkAiProvider, updateAiPreference, updateAiProviderConfig, getAgentRun, getAgentTranscript } = vi.hoisted(
  () => ({
    checkAiProvider: vi.fn(),
    updateAiPreference: vi.fn(),
    updateAiProviderConfig: vi.fn(),
    getAgentRun: vi.fn(),
    getAgentTranscript: vi.fn(),
  }),
)

vi.mock('@admin/api/ai/harness.api', () => ({
  abortAgentRun: vi.fn(),
  archiveAgentSession: vi.fn(),
  createAgentSession: vi.fn(),
  getAgentRun,
  getAgentSession: vi.fn(),
  getAgentSessions: vi.fn(),
  getAgentTranscript,
  startAgentRun: vi.fn(),
  updateAgentSession: vi.fn(),
}))

vi.mock('@admin/api/ai/ai.api', () => ({
  checkAiProvider,
  clearAiProviderCredential: vi.fn(),
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
  updateAiPreference.mockReset()
  updateAiProviderConfig.mockReset()
  getAgentRun.mockReset()
  getAgentTranscript.mockReset()
})

describe('ai query 状态', () => {
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

describe('harness query 分页与轮询', () => {
  const sessionId = '01958c80-8df7-7ce2-8f90-1234567890a1'
  const runId = '01958c80-8df7-7ce2-8f90-1234567890a2'

  it('transcript 首屏取最新一页，加载更早时带上 nextCursor', async () => {
    getAgentTranscript
      .mockResolvedValueOnce({ items: [], nextCursor: 12 })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useAgentTranscriptQuery(sessionId), {
      wrapper: createQueryClientWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(getAgentTranscript).toHaveBeenCalledWith(sessionId, { lane: 'main', limit: 50, direction: 'backward' })
    expect(result.current.hasNextPage).toBe(true)

    await result.current.fetchNextPage()

    await waitFor(() => expect(getAgentTranscript).toHaveBeenCalledTimes(2))
    expect(getAgentTranscript).toHaveBeenLastCalledWith(sessionId, {
      lane: 'main',
      limit: 50,
      direction: 'backward',
      cursor: 12,
    })
    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
  })

  it('默认不轮询 Run 查询，传入间隔后按间隔重新拉取', async () => {
    getAgentRun.mockResolvedValue({ id: runId, status: 'running', live: null })
    const queryClient = createTestQueryClient()
    const once = renderHook(() => useAgentRunQuery(sessionId, runId), {
      wrapper: createQueryClientWrapper(queryClient),
    })
    await waitFor(() => expect(once.result.current.isSuccess).toBe(true))
    expect(getAgentRun).toHaveBeenCalledTimes(1)

    renderHook(() => useAgentRunQuery(sessionId, runId, { refetchInterval: 20 }), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })
    await waitFor(() => expect(getAgentRun.mock.calls.length).toBeGreaterThanOrEqual(3))
  })
})
