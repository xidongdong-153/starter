import { useSystemLogsByRequestIdQuery, useSystemLogsQuery, systemLogsQueryKeys } from '@admin/api/system'
import { LogViewer } from '@admin/features/system/pages/LogViewer'
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
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
    expect(
      systemLogsQueryKeys.page({ page: 2, pageSize: 50, requestId: 'req-1', level: 'error', query: 'boom' }),
    ).toEqual(['system', 'logs', 'page', { page: 2, pageSize: 50, requestId: 'req-1', level: 'error', query: 'boom' }])
  })
})

describe('useSystemLogsQuery', () => {
  beforeEach(() => {
    getSystemLogs.mockReset()
  })

  it('按 page/pageSize 请求并返回 items 与 total', async () => {
    getSystemLogs.mockResolvedValue({ items: [{ time: 1000 }], total: 100 })

    const { result } = renderHook(() => useSystemLogsQuery({ page: 1, pageSize: 20 }), {
      wrapper: createQueryClientWrapper(createTestQueryClient()),
    })

    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ page: 1, pageSize: 20 }))
    await waitFor(() => expect(result.current.data?.total).toBe(100))
    expect(result.current.data?.items).toHaveLength(1)
  })
})

describe('useSystemLogsByRequestIdQuery', () => {
  beforeEach(() => {
    getSystemLogs.mockReset()
  })

  it('requestId 为 null 时不请求；非 null 时按 requestId 查询', async () => {
    getSystemLogs.mockResolvedValue({ items: [], total: 0 })

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

  it('渲染日志列表，筛选提交回到第一页，翻页触发新请求，点击链路展开同 requestId 日志', async () => {
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
      total: 42,
    })

    const { container } = renderWithQueryClient(<LogViewer />, createTestQueryClient())

    await screen.findByText('http.request.completed')
    expect(screen.getByText('llm.failed')).toBeTruthy()
    expect(getSystemLogs).toHaveBeenCalledWith({ page: 1, pageSize: 20 })

    // 关键字筛选：输入后提交表单，发起带 query 的新请求，page 保持 1
    fireEvent.change(screen.getByPlaceholderText('systemLogs.filters.query'), {
      target: { value: 'files.upload' },
    })
    fireEvent.click(screen.getByText('systemLogs.filters.apply'))
    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ page: 1, pageSize: 20, query: 'files.upload' }))

    // 翻页：点击分页器下一页，发起带 page=2 的新请求并渲染第二页数据
    getSystemLogs.mockResolvedValueOnce({
      items: [
        {
          event: 'http.request.page2',
          level: 30,
          msg: '第二页日志',
          requestId: 'req-9',
          time: 3000,
        },
      ],
      total: 42,
    })
    const nextButton = container.querySelector('.ant-pagination-next')
    expect(nextButton).not.toBeNull()
    fireEvent.click(nextButton!)
    await waitFor(() => expect(screen.getByText('http.request.page2')).toBeTruthy())
    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ page: 2, pageSize: 20, query: 'files.upload' }))

    // 链路展开：点击有 requestId 的行，Drawer 请求同 requestId 日志
    fireEvent.click(screen.getByText('systemLogs.link'))
    await waitFor(() => expect(getSystemLogs).toHaveBeenCalledWith({ requestId: 'req-9', limit: 500 }))
  })
})
