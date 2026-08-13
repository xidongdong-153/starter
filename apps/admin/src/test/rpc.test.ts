import { subscribeApiAccessError } from '@admin/api/http'
import { unwrapApiData } from '@admin/api/rpc'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@admin/api/client', () => ({ apiBaseUrl: 'http://localhost:7788' }))

const meta = {
  requestId: 'request-id',
  timestamp: '2026-08-13T00:00:00.000Z',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('admin RPC adapter', () => {
  it('解包成功 envelope', async () => {
    await expect(unwrapApiData(Promise.resolve(jsonResponse({ ok: true, data: { value: 1 }, meta })))).resolves.toEqual(
      { value: 1 },
    )
  })

  it('保留失败状态、错误码和 access-error 通知', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeApiAccessError(listener)

    try {
      await expect(
        unwrapApiData(
          Promise.resolve(
            jsonResponse(
              {
                ok: false,
                error: { code: 'AUTH.UNAUTHENTICATED', message: '请先登录' },
                meta,
              },
              401,
            ),
          ),
        ),
      ).rejects.toMatchObject({
        code: 'AUTH.UNAUTHENTICATED',
        message: '请先登录',
        status: 401,
      })
      expect(listener).toHaveBeenCalledOnce()
      expect(listener).toHaveBeenCalledWith(401)
    } finally {
      unsubscribe()
    }
  })

  it('拒绝 2xx failure envelope', async () => {
    await expect(
      unwrapApiData(
        Promise.resolve(
          jsonResponse({
            ok: false,
            error: { code: 'COMMON.INVALID_REQUEST', message: '请求参数不正确' },
            meta,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'COMMON.INVALID_REQUEST',
      message: '请求参数不正确',
      status: 200,
    })
  })

  it('拒绝无效 envelope 和无效 JSON', async () => {
    await expect(unwrapApiData(Promise.resolve(jsonResponse({ ok: true, data: {} })))).rejects.toMatchObject({
      message: 'API 返回的数据格式不正确。',
      status: 200,
    })

    await expect(unwrapApiData(Promise.resolve(new Response('not-json')))).rejects.toMatchObject({
      message: 'API 没有返回有效的 JSON 数据。',
      status: 200,
    })
  })

  it('把网络错误转成 status 0', async () => {
    await expect(unwrapApiData(Promise.reject(new TypeError('network failed')))).rejects.toMatchObject({
      message: 'API 服务连不上，检查服务是否启动',
      status: 0,
    })
  })
})
