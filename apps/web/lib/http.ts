import type { ApiErrorCode } from '@starter/contracts'
import { resolveApiUrl } from './env.client'

interface ApiFailureBody {
  error: {
    code: ApiErrorCode
    message: string
  }
  ok: false
}

interface ApiSuccessBody {
  data: unknown
  ok: true
}

export class ApiRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

export async function apiRequest(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response

  try {
    response = await fetch(resolveApiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...init?.headers,
      },
    })
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

  return body.data
}

export function isApiRequestError(error: unknown, status?: number): error is ApiRequestError {
  return error instanceof ApiRequestError && (status === undefined || error.status === status)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ApiRequestError(response.status, 'API 没有返回有效的 JSON 数据。')
  }
}

function isApiSuccessBody(value: unknown): value is ApiSuccessBody {
  return isRecord(value) && value.ok === true && 'data' in value && isApiMeta(value.meta)
}

function isApiFailureBody(value: unknown): value is ApiFailureBody {
  return (
    isRecord(value) &&
    value.ok === false &&
    isApiMeta(value.meta) &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  )
}

function isApiMeta(value: unknown): boolean {
  return isRecord(value) && typeof value.requestId === 'string' && typeof value.timestamp === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
