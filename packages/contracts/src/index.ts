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
  AUTHORIZATION_AUDIT_READ: 'authorization-audit:read',
  AUTHORIZATION_MANAGE: 'authorization:manage',
  AUTHORIZATION_READ: 'authorization:read',
  FILE_DELETE: 'file:delete',
  FILE_LIST: 'file:list',
  FILE_READ: 'file:read',
  FILE_RENAME: 'file:rename',
  FILE_UPLOAD: 'file:upload',
  SYSTEM_LOGS_READ: 'system:logs:read',
} as const

export const RoleKeys = {
  ADMIN: 'admin',
  OPERATOR: 'operator',
  VIEWER: 'viewer',
} as const

/**
 * 互斥角色组（NIST RBAC 静态职责分离，INCITS 359）。
 * 组内角色两两互斥：一个用户至多持有组内一个角色。
 * 单元素组表示独占角色：持有该角色时不能持有任何其他角色。
 */
export const ExclusiveRoleGroups: readonly (readonly string[])[] = [[RoleKeys.ADMIN]] as const

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

export const roleNameSchema = z.string().trim().min(1).max(80)
export const roleDescriptionSchema = z.string().trim().max(500).nullable()

export const createRoleSchema = z.object({
  key: roleKeySchema,
  name: roleNameSchema,
  description: roleDescriptionSchema,
  permissionKeys: uniqueArraySchema(permissionSchema),
})

export const updateRoleSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: roleDescriptionSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: '至少提供一个要修改的字段',
  })

export const roleCatalogStatusSchema = z.enum(['active', 'archived']).default('active')

export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>
export type RoleCatalogStatus = z.infer<typeof roleCatalogStatusSchema>

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
  archivedAt: string | null
  metadataEditable: boolean
  permissionsEditable: boolean
  lifecycleEditable: boolean
  permissionKeys: Permission[]
}

export interface AuthorizationRoleImpact {
  roleKey: string
  assignedUserCount: number
}

export interface AuthorizationPermissionImpact {
  permissionKey: Permission
  roleKeys: string[]
  affectedUserCount: number
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

export type SystemLogLevel = 'info' | 'warn' | 'error'

/** Pino 日志行解析后的完整对象，字段不固定 */
export type SystemLogEntry = Record<string, unknown>

export interface SystemLogsQuery {
  requestId?: string
  level?: SystemLogLevel
  query?: string
  limit: number
  before?: number
}

export interface SystemLogsResponse {
  items: SystemLogEntry[]
}

export const userStatusSchema = z.enum(['active', 'suspended'])

export type UserStatus = z.infer<typeof userStatusSchema>

export const updateUserStatusSchema = z.object({
  status: userStatusSchema,
})

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>

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
  status: UserStatus
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

export const AuditActions = {
  PLATFORM_ADMIN_GRANTED: 'platform_admin.granted',
  PLATFORM_ADMIN_REVOKED: 'platform_admin.revoked',
  ROLE_ARCHIVED: 'role.archived',
  ROLE_CREATED: 'role.created',
  ROLE_PERMISSIONS_REPLACED: 'role_permissions.replaced',
  ROLE_RESTORED: 'role.restored',
  ROLE_UPDATED: 'role.updated',
  USER_ROLES_INITIALIZED: 'user_roles.initialized',
  USER_ROLES_REPLACED: 'user_roles.replaced',
  USER_STATUS_CHANGED: 'user.status_changed',
} as const

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions]

export const auditActionSchema = z.enum(AuditActions)

/** payload 形状为 { roleKeys } 的 action，与 role_permissions.replaced 相对。 */
export const UserRolesAuditActions = [
  AuditActions.PLATFORM_ADMIN_GRANTED,
  AuditActions.PLATFORM_ADMIN_REVOKED,
  AuditActions.USER_ROLES_INITIALIZED,
  AuditActions.USER_ROLES_REPLACED,
] as const

export type UserRolesAuditAction = (typeof UserRolesAuditActions)[number]

/** payload 形状为 { archived } 的角色生命周期 action。 */
export const RoleLifecycleAuditActions = [AuditActions.ROLE_ARCHIVED, AuditActions.ROLE_RESTORED] as const

export type RoleLifecycleAuditAction = (typeof RoleLifecycleAuditActions)[number]

export const auditRoleKeysPayloadSchema = z.object({
  roleKeys: z.array(roleKeySchema),
})
export const auditPermissionKeysPayloadSchema = z.object({
  permissionKeys: z.array(permissionSchema),
})
export const auditRoleCreatedBeforeSchema = z.object({
  role: z.null(),
})
export const auditRoleCreatedAfterSchema = z.object({
  role: z.object({
    name: z.string(),
    description: z.string().nullable(),
    permissionKeys: z.array(permissionSchema),
    archived: z.literal(false),
  }),
})
export const auditRoleMetadataPayloadSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
})
export const auditRoleLifecyclePayloadSchema = z.object({
  archived: z.boolean(),
})
export const auditUserStatusPayloadSchema = z.object({
  status: userStatusSchema,
})

export type AuditRoleKeysPayload = z.infer<typeof auditRoleKeysPayloadSchema>
export type AuditPermissionKeysPayload = z.infer<typeof auditPermissionKeysPayloadSchema>
export type AuditRoleCreatedBefore = z.infer<typeof auditRoleCreatedBeforeSchema>
export type AuditRoleCreatedAfter = z.infer<typeof auditRoleCreatedAfterSchema>
export type AuditRoleMetadataPayload = z.infer<typeof auditRoleMetadataPayloadSchema>
export type AuditRoleLifecyclePayload = z.infer<typeof auditRoleLifecyclePayloadSchema>
export type AuditUserStatusPayload = z.infer<typeof auditUserStatusPayloadSchema>
export type AuditPayload =
  | AuditRoleKeysPayload
  | AuditPermissionKeysPayload
  | AuditRoleCreatedBefore
  | AuditRoleCreatedAfter
  | AuditRoleMetadataPayload
  | AuditRoleLifecyclePayload
  | AuditUserStatusPayload

export const authorizationAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: auditActionSchema.optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  targetId: z.string().trim().min(1).max(64).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
})

export type AuthorizationAuditQuery = z.infer<typeof authorizationAuditQuerySchema>

interface AuthorizationAuditEventBase {
  id: string
  actorType: 'user' | 'system'
  actorId: string
  targetId: string
  reason: string | null
  requestId: string | null
  createdAt: string
}

export type AuthorizationAuditEvent = AuthorizationAuditEventBase &
  (
    | {
        action: UserRolesAuditAction
        targetType: 'user'
        before: AuditRoleKeysPayload
        after: AuditRoleKeysPayload
      }
    | {
        action: typeof AuditActions.ROLE_PERMISSIONS_REPLACED
        targetType: 'role'
        before: AuditPermissionKeysPayload
        after: AuditPermissionKeysPayload
      }
    | {
        action: typeof AuditActions.ROLE_CREATED
        targetType: 'role'
        before: AuditRoleCreatedBefore
        after: AuditRoleCreatedAfter
      }
    | {
        action: typeof AuditActions.ROLE_UPDATED
        targetType: 'role'
        before: AuditRoleMetadataPayload
        after: AuditRoleMetadataPayload
      }
    | {
        action: RoleLifecycleAuditAction
        targetType: 'role'
        before: AuditRoleLifecyclePayload
        after: AuditRoleLifecyclePayload
      }
    | {
        action: typeof AuditActions.USER_STATUS_CHANGED
        targetType: 'user'
        before: AuditUserStatusPayload
        after: AuditUserStatusPayload
      }
  )

export interface AuthorizationAuditEventPage {
  items: AuthorizationAuditEvent[]
  total: number
  page: number
  pageSize: number
}
