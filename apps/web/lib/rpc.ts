import { hc } from 'hono/client'
import type { AppType } from '@starter/api/rpc'

import { apiUrl } from './env.client'
import { ApiRequestError, isApiFailureBody, isApiSuccessBody, readJson } from './http'

/**
 * 普通 JSON 接口的 Hono RPC 客户端。
 * 页面和组件不直接使用，领域 API 函数通过它发起类型化请求。
 */
export const apiRpc = hc<AppType>(apiUrl, {
  init: { credentials: 'include' },
  headers: { accept: 'application/json' },
})

/**
 * 执行 RPC 请求并解包统一 envelope。
 * 网络错误、非 2xx、无效 envelope 都转换为 ApiRequestError。
 */
export async function unwrapApiData<TData>(request: Promise<Response>): Promise<TData> {
  let response: Response

  try {
    response = await request
  } catch {
    throw new ApiRequestError(0, 'API 服务连不上，请确认服务已经启动。')
  }

  const body = await readJson(response)

  if (!response.ok) {
    const message = isApiFailureBody(body) ? body.error.message : `请求失败：${response.status}`
    throw new ApiRequestError(response.status, message)
  }

  if (!isApiSuccessBody(body)) {
    throw new ApiRequestError(response.status, 'API 返回的数据格式不正确。')
  }

  return body.data as TData
}
