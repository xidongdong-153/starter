import { z } from 'zod'

export const ApiErrorCodes = {
  AUTH_SESSION_INVALID: 'AUTH.SESSION_INVALID',
  AUTH_UNAUTHENTICATED: 'AUTH.UNAUTHENTICATED',
  COMMON_INVALID_REQUEST: 'COMMON.INVALID_REQUEST',
  COMMON_NOT_FOUND: 'COMMON.NOT_FOUND',
  COMMON_PAYLOAD_TOO_LARGE: 'COMMON.PAYLOAD_TOO_LARGE',
  FILES_UNSUPPORTED_TYPE: 'FILES.UNSUPPORTED_TYPE',
  SYSTEM_INTERNAL_ERROR: 'SYSTEM.INTERNAL_ERROR',
  SYSTEM_UPSTREAM_TIMEOUT: 'SYSTEM.UPSTREAM_TIMEOUT',
} as const

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes]

export interface ApiMeta {
  requestId: string
  timestamp: string
}

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

export function buildSuccess<TData>(data: TData, meta: ApiMeta): ApiSuccess<TData> {
  return { ok: true, data, meta }
}

export function buildFailure<TDetails>(error: ApiError<TDetails>, meta: ApiMeta): ApiFailure<TDetails> {
  return { ok: false, error, meta }
}

export const uuidSchema = z.uuidv7()
export const socialLinksSchema = z.array(z.url()).max(8)

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(500).nullable(),
  contactEmail: z.email().nullable(),
  location: z.string().trim().max(120).nullable(),
  availableForWork: z.boolean(),
  socialLinks: socialLinksSchema,
})

export const setAvatarSchema = z.object({ fileId: uuidSchema })
export const renameFileSchema = z.object({ name: z.string().trim().min(1).max(255) })

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type PublicProfile = UpdateProfileInput & {
  userId: string
  avatarUrl: string | null
  updatedAt: string
}
export type AccountProfile = PublicProfile & {
  email: string
  providers: string[]
}
export type FileItem = {
  id: string
  name: string
  mimeType: string
  size: number
  createdAt: string
  updatedAt: string
  contentUrl: string
}
export type AuthConfig = {
  providers: { email: true; github: boolean; google: boolean }
}
