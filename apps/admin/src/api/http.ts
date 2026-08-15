import type { ApiErrorCode } from '@starter/contracts'

import { resolveApiUrl } from './client'

export type ApiAccessErrorStatus = 401 | 403

type ApiAccessErrorListener = (status: ApiAccessErrorStatus) => void

const apiAccessErrorListeners = new Set<ApiAccessErrorListener>()

interface ApiErrorBody {
  error?: { code?: unknown; message?: unknown }
  message?: unknown
}

interface ApiFailureBody {
  error: {
    code?: unknown
    message: string
  }
  meta: {
    requestId: string
    timestamp: string
  }
  ok: false
}

interface ApiSuccessBody<TData> {
  data: TData
  meta: {
    requestId: string
    timestamp: string
  }
  ok: true
}

/**
 * 接口请求失败时抛出的错误，带 HTTP 状态码
 */
export class ApiRequestError extends Error {
  readonly code?: ApiErrorCode
  readonly status: number

  constructor(status: number, message: string, code?: ApiErrorCode) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
  }
}

export function isUnauthorizedError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 401
}

export function isForbiddenError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 403
}

export function isConflictError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 409
}

export function subscribeApiAccessError(listener: ApiAccessErrorListener) {
  apiAccessErrorListeners.add(listener)

  return () => {
    apiAccessErrorListeners.delete(listener)
  }
}

export function notifyApiAccessError(status: number) {
  if (status !== 401 && status !== 403) {
    return
  }

  apiAccessErrorListeners.forEach((listener) => listener(status))
}

/**
 * 调用 API 服务并读取 JSON。
 * FormData 请求不设置 Content-Type，交给浏览器处理 boundary。
 */
export async function apiRequest<TData>(path: string, init?: RequestInit): Promise<TData> {
  const response = await fetchApi(path, init)

  if (!response.ok) {
    const error = await resolveApiError(response)
    throw new ApiRequestError(response.status, error.message, error.code)
  }

  const body = await readJson(response)
  if (!isApiSuccessBody<TData>(body)) {
    throw new ApiRequestError(response.status, 'API 返回的数据格式不正确。')
  }

  return body.data
}

/**
 * 调用 API 服务并返回原始响应，用于下载文件这类场景
 */
export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const isFormData = init?.body instanceof FormData

  try {
    const response = await fetch(resolveApiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        ...(isFormData ? {} : { 'content-type': 'application/json' }),
        ...init?.headers,
      },
    })

    notifyApiAccessError(response.status)
    return response
  } catch (error) {
    if (init?.signal?.aborted) {
      const reason = init.signal.reason
      if (reason instanceof Error) throw reason
      throw error
    }
    throw new ApiRequestError(0, 'API 服务连不上，检查服务是否启动')
  }
}

export async function resolveApiError(response: Response): Promise<{ code?: ApiErrorCode; message: string }> {
  const body = await readErrorBody(response)
  const message = body?.error?.message ?? body?.message
  const code = typeof body?.error?.code === 'string' ? (body.error.code as ApiErrorCode) : undefined

  if (typeof message === 'string' && message.trim() !== '') {
    return { code, message }
  }

  if (response.status === 401) {
    return { code, message: '请先登录' }
  }

  if (response.status === 403) {
    return { code, message: '当前账号没有这个操作的权限' }
  }

  return { code, message: `请求失败: ${response.status}` }
}

export function isApiSuccessBody<TData>(body: unknown): body is ApiSuccessBody<TData> {
  if (typeof body !== 'object' || body === null || !('ok' in body) || body.ok !== true || !('data' in body)) {
    return false
  }

  return hasApiMeta(body)
}

export function isApiFailureBody(body: unknown): body is ApiFailureBody {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('ok' in body) ||
    body.ok !== false ||
    !('error' in body) ||
    typeof body.error !== 'object' ||
    body.error === null ||
    !('message' in body.error) ||
    typeof body.error.message !== 'string'
  ) {
    return false
  }

  return hasApiMeta(body)
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ApiRequestError(response.status, 'API 没有返回有效的 JSON 数据。')
  }
}

function hasApiMeta(body: object): body is { meta: { requestId: string; timestamp: string } } {
  if (!('meta' in body) || typeof body.meta !== 'object' || body.meta === null) {
    return false
  }

  return (
    'requestId' in body.meta &&
    typeof body.meta.requestId === 'string' &&
    'timestamp' in body.meta &&
    typeof body.meta.timestamp === 'string'
  )
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody
  } catch {
    return null
  }
}
