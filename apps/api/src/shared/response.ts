import type { ApiError, ApiFailure, ApiSuccess } from '@starter/contracts'
import { buildFailure, buildSuccess } from '@starter/contracts'
import { createMeta } from './meta.js'

export function createSuccessResponse<T>(data: T, requestId: string): ApiSuccess<T> {
  return buildSuccess(data, createMeta(requestId))
}

export function createFailureResponse(error: ApiError, requestId: string): ApiFailure {
  return buildFailure(error, createMeta(requestId))
}
