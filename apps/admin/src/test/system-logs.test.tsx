import { useSystemLogsByRequestIdQuery, useSystemLogsQuery, systemLogsQueryKeys } from '@admin/api/system'
import { LogViewer } from '@admin/features/system/pages/LogViewer'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClientWrapper, createTestQueryClient, renderWithQueryClient } from './helpers'

const { getSystemLogs } = vi.hoisted(() => ({
  getSystemLogs: vi.fn(),
}))

vi.mock('@admin/api/system/logs.api', () => ({ getSystemLogs }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('systemLogsQueryKeys', () => {
  it('page key 包含完整筛选条件', () => {
    expect(systemLogsQueryKeys.page({ limit: 50, requestId: 'req-1', level: 'error', query: 'boom' })).toEqual([
      'system',
      'logs',
      'page',
      { limit: 50, requestId: 'req-1', level: 'error', query: 'boom' },
    ])
  })
})

describe('useSystemLogsQuery', () => {
  beforeEach(() => {
    getSystemLogs.mockReset()
  })

  it('首页不带 before；满页时加载更多用最后一条 time 作为 before', async () => {
    getSystemLogs.mockResolvedValue({ items: Array.from({ length: 50 }, (_, index) => ({ time: 5000 - index })) })

    const { result } = renderHook(() => useSystemLogsQuery({}), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ limit: 50 }))
    await waitFor(() => expect(result.current.hasNextPage).toBe(true))

    getSystemLogs.mockResolvedValue({ items: [{ time: 4000 }] })
    await act(async () => {
      await result.current.fetchNextPage()
    })
    expect(getSystemLogs).toHaveBeenLastCalledWith({ before: 4951, limit: 50 })
    await waitFor(() => expect(result.current.data?.pages.length).toBe(2))
  })

  it('不足一页时没有下一页', async () => {
    getSystemLogs.mockResolvedValue({ items: [{ time: 1000 }] })

    const { result } = renderHook(() => useSystemLogsQuery({}), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => expect(result.current.hasNextPage).toBe(false))
  })
})

describe('useSystemLogsByRequestIdQuery', () => {
  beforeEach(() => {
    getSystemLogs.mockReset()
  })

  it('requestId 为 null 时不请求；非 null 时按 requestId 查询', async () => {
    getSystemLogs.mockResolvedValue({ items: [] })

    const { result, rerender } = renderHook(
      ({ requestId }: { requestId: string | null }) => useSystemLogsByRequestIdQuery(requestId),
      {
        initialProps: { requestId: null } as { requestId: string | null },
        wrapper: createQueryClientWrapper(createTestQueryClient()),
      },
    )

    expect(getSystemLogs).not.toHaveBeenCalled()

    rerender({ requestId: 'req-1' })
    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ requestId: 'req-1', limit: 500 }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('日志查看页', () => {
  beforeEach(() => {
    getSystemLogs.mockReset()
  })

  it('渲染日志列表，筛选触发新请求，点击链路展开同 requestId 日志', async () => {
    getSystemLogs.mockResolvedValue({
      items: [
        {
          durationMs: 120,
          event: 'http.request.completed',
          level: 30,
          msg: '请求完成',
          requestId: 'req-1',
          status: 200,
          time: 2000,
          userId: 'u-1',
        },
        {
          err: { message: 'x' },
          event: 'llm.failed',
          level: 50,
          msg: 'boom',
          time: 1000,
        },
      ],
    })

    renderWithQueryClient(<LogViewer />, createTestQueryClient())

    await screen.findByText('http.request.completed')
    expect(screen.getByText('llm.failed')).toBeTruthy()
    expect(getSystemLogs).toHaveBeenCalledWith({ limit: 50 })

    // 关键字筛选：输入后提交表单，发起带 query 的新请求
    fireEvent.change(screen.getByPlaceholderText('systemLogs.filters.query'), {
      target: { value: 'files.upload' },
    })
    fireEvent.click(screen.getByText('systemLogs.filters.apply'))
    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ limit: 50, query: 'files.upload' }))

    // 链路展开：点击有 requestId 的行，Drawer 请求同 requestId 日志
    fireEvent.click(screen.getByText('systemLogs.link'))
    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ requestId: 'req-1', limit: 500 }))
  })
})
