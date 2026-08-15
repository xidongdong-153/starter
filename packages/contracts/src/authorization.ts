import { z } from 'zod'

import { isoDateTimeSchema, uuidSchema } from './common.js'

export const PermissionKeys = {
  AUTHORIZATION_AUDIT_READ: 'authorization-audit:read',
  AUTHORIZATION_MANAGE: 'authorization:manage',
  AUTHORIZATION_READ: 'authorization:read',
  AI_CONFIG_MANAGE: 'ai:config:manage',
  AI_CONFIG_READ: 'ai:config:read',
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

export const currentPermissionsSchema = z.object({
  roles: z.array(roleKeySchema),
  permissions: z.array(permissionSchema),
  version: z.string().regex(/^[0-9a-f]{16}$/),
})

export type CurrentPermissions = z.infer<typeof currentPermissionsSchema>

export const authorizationUserSchema = z.object({
  id: z.uuidv7(),
  name: z.string(),
  email: z.email(),
  roleKeys: z.array(roleKeySchema),
})

export type AuthorizationUser = z.infer<typeof authorizationUserSchema>

export const authorizationRoleSchema = z.object({
  key: roleKeySchema,
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  archivedAt: isoDateTimeSchema.nullable(),
  metadataEditable: z.boolean(),
  permissionsEditable: z.boolean(),
  lifecycleEditable: z.boolean(),
  permissionKeys: z.array(permissionSchema),
})

export type AuthorizationRole = z.infer<typeof authorizationRoleSchema>

export const authorizationRoleImpactSchema = z.object({
  roleKey: roleKeySchema,
  assignedUserCount: z.number().int().min(0),
})

export type AuthorizationRoleImpact = z.infer<typeof authorizationRoleImpactSchema>

export const authorizationPermissionImpactSchema = z.object({
  permissionKey: permissionSchema,
  roleKeys: z.array(roleKeySchema),
  affectedUserCount: z.number().int().min(0),
})

export type AuthorizationPermissionImpact = z.infer<typeof authorizationPermissionImpactSchema>

export const authorizationPermissionSchema = z.object({
  key: permissionSchema,
  resource: z.string(),
  action: z.string(),
  description: z.string().nullable(),
})

export type AuthorizationPermission = z.infer<typeof authorizationPermissionSchema>

export const authorizationRoleCatalogSchema = z.object({
  roles: z.array(authorizationRoleSchema),
  permissions: z.array(authorizationPermissionSchema),
})

export type AuthorizationRoleCatalog = z.infer<typeof authorizationRoleCatalogSchema>

export const authorizationUserParamsSchema = z.object({
  userId: uuidSchema,
})

export const authorizationRoleParamsSchema = z.object({
  roleKey: roleKeySchema,
})

export const authorizationPermissionParamsSchema = z.object({
  permissionKey: permissionSchema,
})

export const authorizationRoleCatalogQuerySchema = z.object({
  status: roleCatalogStatusSchema.optional().default('active'),
})

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
  status: z.enum(['active', 'suspended']),
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

const authorizationAuditEventBaseSchema = z.object({
  id: uuidSchema,
  actorType: z.enum(['user', 'system']),
  actorId: z.string(),
  targetId: z.string(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
})

export const authorizationAuditEventSchema = z.union([
  authorizationAuditEventBaseSchema.extend({
    action: z.enum(UserRolesAuditActions),
    targetType: z.literal('user'),
    before: auditRoleKeysPayloadSchema,
    after: auditRoleKeysPayloadSchema,
  }),
  authorizationAuditEventBaseSchema.extend({
    action: z.literal(AuditActions.ROLE_PERMISSIONS_REPLACED),
    targetType: z.literal('role'),
    before: auditPermissionKeysPayloadSchema,
    after: auditPermissionKeysPayloadSchema,
  }),
  authorizationAuditEventBaseSchema.extend({
    action: z.literal(AuditActions.ROLE_CREATED),
    targetType: z.literal('role'),
    before: auditRoleCreatedBeforeSchema,
    after: auditRoleCreatedAfterSchema,
  }),
  authorizationAuditEventBaseSchema.extend({
    action: z.literal(AuditActions.ROLE_UPDATED),
    targetType: z.literal('role'),
    before: auditRoleMetadataPayloadSchema,
    after: auditRoleMetadataPayloadSchema,
  }),
  authorizationAuditEventBaseSchema.extend({
    action: z.enum(RoleLifecycleAuditActions),
    targetType: z.literal('role'),
    before: auditRoleLifecyclePayloadSchema,
    after: auditRoleLifecyclePayloadSchema,
  }),
  authorizationAuditEventBaseSchema.extend({
    action: z.literal(AuditActions.USER_STATUS_CHANGED),
    targetType: z.literal('user'),
    before: auditUserStatusPayloadSchema,
    after: auditUserStatusPayloadSchema,
  }),
])

export type AuthorizationAuditEvent = z.infer<typeof authorizationAuditEventSchema>

export const authorizationAuditEventPageSchema = z.object({
  items: z.array(authorizationAuditEventSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
})

export type AuthorizationAuditEventPage = z.infer<typeof authorizationAuditEventPageSchema>
