import { z } from 'zod'

export const ApiErrorCodes = {
  AUTH_FORBIDDEN: 'AUTH.FORBIDDEN',
  AUTH_LAST_PLATFORM_ADMIN: 'AUTH.LAST_PLATFORM_ADMIN',
  AUTH_ROLE_CONFLICT: 'AUTH.ROLE_CONFLICT',
  AUTH_ROLE_IN_USE: 'AUTH.ROLE_IN_USE',
  AUTH_ROLE_KEY_CONFLICT: 'AUTH.ROLE_KEY_CONFLICT',
  AUTH_SESSION_INVALID: 'AUTH.SESSION_INVALID',
  AUTH_UNAUTHENTICATED: 'AUTH.UNAUTHENTICATED',
  AUTH_USER_SUSPENDED: 'AUTH.USER_SUSPENDED',
  AI_CATALOG_REFRESH_FAILED: 'AI.CATALOG_REFRESH_FAILED',
  AI_AGENT_CONFIG_INVALID: 'AI.AGENT_CONFIG_INVALID',
  AI_AGENT_NAME_CONFLICT: 'AI.AGENT_NAME_CONFLICT',
  AI_AGENT_NOT_ENABLED: 'AI.AGENT_NOT_ENABLED',
  AI_APP_CREDENTIAL_CONFLICT: 'AI.APP_CREDENTIAL_CONFLICT',
  AI_APP_CREDENTIAL_NOT_FOUND: 'AI.APP_CREDENTIAL_NOT_FOUND',
  AI_APP_CREDENTIAL_REVOKED: 'AI.APP_CREDENTIAL_REVOKED',
  AI_CONFIG_INVALID: 'AI.CONFIG_INVALID',
  AI_CREDENTIAL_CONFLICT: 'AI.CREDENTIAL_CONFLICT',
  AI_CREDENTIAL_KEY_UNAVAILABLE: 'AI.CREDENTIAL_KEY_UNAVAILABLE',
  AI_MODEL_NOT_ALLOWED: 'AI.MODEL_NOT_ALLOWED',
  AI_MODEL_NOT_FOUND: 'AI.MODEL_NOT_FOUND',
  AI_NO_AVAILABLE_MODEL: 'AI.NO_AVAILABLE_MODEL',
  AI_PROVIDER_AUTH_FAILED: 'AI.PROVIDER_AUTH_FAILED',
  AI_PROVIDER_DISABLED: 'AI.PROVIDER_DISABLED',
  AI_PROVIDER_NOT_CONFIGURED: 'AI.PROVIDER_NOT_CONFIGURED',
  AI_PROVIDER_NOT_FOUND: 'AI.PROVIDER_NOT_FOUND',
  AI_PROMPT_NAME_CONFLICT: 'AI.PROMPT_NAME_CONFLICT',
  AI_PROMPT_NOT_FOUND: 'AI.PROMPT_NOT_FOUND',
  AI_PROMPT_REFERENCED: 'AI.PROMPT_REFERENCED',
  AI_REQUEST_ABORTED: 'AI.REQUEST_ABORTED',
  AI_RUN_INTERRUPTED: 'AI.RUN_INTERRUPTED',
  AI_RUN_NOT_ACTIVE: 'AI.RUN_NOT_ACTIVE',
  AI_SESSION_BUSY: 'AI.SESSION_BUSY',
  AI_SESSION_STORAGE_FAILED: 'AI.SESSION_STORAGE_FAILED',
  AI_SKILL_NAME_CONFLICT: 'AI.SKILL_NAME_CONFLICT',
  AI_SKILL_NOT_FOUND: 'AI.SKILL_NOT_FOUND',
  AI_TOOL_CANCELLED: 'AI.TOOL_CANCELLED',
  AI_TOOL_FAILED: 'AI.TOOL_FAILED',
  AI_TOOL_FORBIDDEN: 'AI.TOOL_FORBIDDEN',
  AI_TOOL_INVALID_ARGUMENTS: 'AI.TOOL_INVALID_ARGUMENTS',
  AI_TOOL_NOT_FOUND: 'AI.TOOL_NOT_FOUND',
  AI_TOOL_TIMED_OUT: 'AI.TOOL_TIMED_OUT',
  AI_UPSTREAM_ERROR: 'AI.UPSTREAM_ERROR',
  AI_UPSTREAM_TIMEOUT: 'AI.UPSTREAM_TIMEOUT',
  COMMON_INVALID_REQUEST: 'COMMON.INVALID_REQUEST',
  COMMON_NOT_FOUND: 'COMMON.NOT_FOUND',
  COMMON_PAYLOAD_TOO_LARGE: 'COMMON.PAYLOAD_TOO_LARGE',
  FILES_UNSUPPORTED_TYPE: 'FILES.UNSUPPORTED_TYPE',
  SYSTEM_INTERNAL_ERROR: 'SYSTEM.INTERNAL_ERROR',
  SYSTEM_UPSTREAM_TIMEOUT: 'SYSTEM.UPSTREAM_TIMEOUT',
} as const

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes]

export const apiErrorCodeSchema = z.enum(ApiErrorCodes)

export const isoDateTimeSchema = z.iso.datetime()
export const uuidSchema = z.uuidv7()
export const socialLinksSchema = z.array(z.url()).max(8)
export const okSchema = z.object({ ok: z.literal(true) })
export const userStatusSchema = z.enum(['active', 'suspended'])

export type UserStatus = z.infer<typeof userStatusSchema>

export const apiMetaSchema = z.object({
  requestId: z.string(),
  timestamp: isoDateTimeSchema,
})

export type ApiMeta = z.infer<typeof apiMetaSchema>

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
})

export interface ApiError<TDetails = unknown> {
  code: ApiErrorCode
  message: string
  details?: TDetails
}

export interface ApiSuccess<TData> {
  ok: true
  data: TData
  meta: ApiMeta
}

export interface ApiFailure<TDetails = unknown> {
  ok: false
  error: ApiError<TDetails>
  meta: ApiMeta
}

export type ApiResponse<TData, TDetails = unknown> = ApiSuccess<TData> | ApiFailure<TDetails>

export function apiSuccessSchema<TDataSchema extends z.ZodType>(dataSchema: TDataSchema) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
    meta: apiMetaSchema,
  })
}

export const apiFailureSchema = z.object({
  ok: z.literal(false),
  error: apiErrorSchema,
  meta: apiMetaSchema,
})

export function buildSuccess<TData>(data: TData, meta: ApiMeta): ApiSuccess<TData> {
  return { ok: true, data, meta }
}

export function buildFailure<TDetails>(error: ApiError<TDetails>, meta: ApiMeta): ApiFailure<TDetails> {
  return { ok: false, error, meta }
}

/** 用户 ID 路径参数，跨域通用 */
export const userIdParamsSchema = z.object({ userId: uuidSchema })
