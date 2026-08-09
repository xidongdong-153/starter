import { z } from 'zod'

export const ApiErrorCodes = {
  AUTH_FORBIDDEN: 'AUTH.FORBIDDEN',
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

export const PermissionKeys = {
  AUTHORIZATION_MANAGE: 'authorization:manage',
  AUTHORIZATION_READ: 'authorization:read',
  FILE_DELETE: 'file:delete',
  FILE_LIST: 'file:list',
  FILE_READ: 'file:read',
  FILE_RENAME: 'file:rename',
  FILE_UPLOAD: 'file:upload',
} as const

export const RoleKeys = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
} as const

export type Permission = (typeof PermissionKeys)[keyof typeof PermissionKeys]
export type SystemRole = (typeof RoleKeys)[keyof typeof RoleKeys]

export const permissionSchema = z.enum(PermissionKeys)
export const roleKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/)

function uniqueArraySchema<T extends z.ZodType>(itemSchema: T) {
  return z.array(itemSchema).superRefine((items, context) => {
    if (new Set(items).size !== items.length) {
      context.addIssue({ code: 'custom', message: '不能包含重复项' })
    }
  })
}

export const replaceUserRolesSchema = z.object({
  roleKeys: uniqueArraySchema(roleKeySchema).min(1),
})
export const replaceRolePermissionsSchema = z.object({
  permissionKeys: uniqueArraySchema(permissionSchema),
})

export type ReplaceUserRolesInput = z.infer<typeof replaceUserRolesSchema>
export type ReplaceRolePermissionsInput = z.infer<typeof replaceRolePermissionsSchema>

export interface CurrentPermissions {
  roles: string[]
  permissions: Permission[]
  version: string
}

export interface AuthorizationUser {
  id: string
  name: string
  email: string
  roleKeys: string[]
}

export interface AuthorizationRole {
  key: string
  name: string
  description: string | null
  isSystem: boolean
  permissionsEditable: boolean
  permissionKeys: Permission[]
}

export interface AuthorizationPermission {
  key: Permission
  resource: string
  action: string
  description: string | null
}

export interface AuthorizationRoleCatalog {
  roles: AuthorizationRole[]
  permissions: AuthorizationPermission[]
}

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

export const userManagementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  roleKey: z.string().trim().min(1).max(64).optional(),
})

export type UserManagementQuery = z.infer<typeof userManagementQuerySchema>

export interface UserManagementUser {
  id: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
  createdAt: string
  updatedAt: string
  roleKeys: string[]
}

export interface UserManagementUserPage {
  items: UserManagementUser[]
  total: number
  page: number
  pageSize: number
}

export interface UserManagementProfile {
  bio: string | null
  contactEmail: string | null
  location: string | null
  availableForWork: boolean
  socialLinks: string[]
  avatarUrl: string | null
  updatedAt: string | null
}

export interface UserManagementUserDetail extends UserManagementUser {
  providers: string[]
  profile: UserManagementProfile | null
}
