import { hc } from 'hono/client'
import type { AppType } from '@starter/api/rpc'
import type { ApiErrorCode } from '@starter/contracts'

import { apiBaseUrl } from './client'
import {
  ApiRequestError,
  isApiFailureBody,
  isApiSuccessBody,
  notifyApiAccessError,
  readJson,
  resolveApiError,
} from './http'

/**
 * 普通 JSON 接口的 Hono RPC 客户端。
 * 页面和组件不直接使用，领域 API 函数通过它发起类型化请求。
 */
export const apiRpc = hc<AppType>(apiBaseUrl, {
  init: { credentials: 'include' },
  headers: { accept: 'application/json' },
})

/**
 * 执行 RPC 请求并解包统一 envelope。
 * 网络错误转为 ApiRequestError(0)，非 2xx 转为带状态码的错误并通知 401/403 监听器。
 */
export async function unwrapApiData<TData>(request: Promise<Response>): Promise<TData> {
  let response: Response

  try {
    response = await request
  } catch {
    throw new ApiRequestError(0, 'API 服务连不上，检查服务是否启动')
  }

  notifyApiAccessError(response.status)

  if (!response.ok) {
    const error = await resolveApiError(response)
    throw new ApiRequestError(response.status, error.message, error.code)
  }

  const body = await readJson(response)

  if (isApiFailureBody(body)) {
    const code = typeof body.error.code === 'string' ? (body.error.code as ApiErrorCode) : undefined
    throw new ApiRequestError(response.status, body.error.message, code)
  }

  if (!isApiSuccessBody(body)) {
    throw new ApiRequestError(response.status, 'API 返回的数据格式不正确。')
  }

  return body.data as TData
}

/**
 * 执行不返回响应体的 RPC 请求，例如 204 删除接口。
 */
export async function unwrapApiVoid(request: Promise<Response>): Promise<void> {
  let response: Response

  try {
    response = await request
  } catch {
    throw new ApiRequestError(0, 'API 服务连不上，检查服务是否启动')
  }

  notifyApiAccessError(response.status)

  if (!response.ok) {
    const error = await resolveApiError(response)
    throw new ApiRequestError(response.status, error.message, error.code)
  }
}
