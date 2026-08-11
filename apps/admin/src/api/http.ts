import { resolveApiUrl } from './client'

export type ApiAccessErrorStatus = 401 | 403

type ApiAccessErrorListener = (status: ApiAccessErrorStatus) => void

const apiAccessErrorListeners = new Set<ApiAccessErrorListener>()

interface ApiErrorBody {
  error?: { message?: unknown }
  message?: unknown
}

interface ApiSuccessBody<TData> {
  data: TData
  ok: true
}

/**
 * 接口请求失败时抛出的错误，带 HTTP 状态码
 */
export class ApiRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
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

function notifyApiAccessError(status: number) {
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
    throw new ApiRequestError(response.status, await resolveErrorMessage(response))
  }

  const body = (await response.json()) as TData | ApiSuccessBody<TData>
  return isApiSuccessBody(body) ? body.data : body
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
  } catch {
    throw new ApiRequestError(0, 'API 服务连不上，检查服务是否启动')
  }
}

async function resolveErrorMessage(response: Response): Promise<string> {
  const body = await readErrorBody(response)
  const message = body?.error?.message ?? body?.message

  if (typeof message === 'string' && message.trim() !== '') {
    return message
  }

  if (response.status === 401) {
    return '请先登录'
  }

  if (response.status === 403) {
    return '当前账号没有这个操作的权限'
  }

  return `请求失败: ${response.status}`
}

function isApiSuccessBody<TData>(body: TData | ApiSuccessBody<TData>): body is ApiSuccessBody<TData> {
  return typeof body === 'object' && body !== null && 'ok' in body && body.ok === true && 'data' in body
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody
  } catch {
    return null
  }
}
