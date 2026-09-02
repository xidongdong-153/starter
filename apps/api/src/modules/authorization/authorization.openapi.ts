import { z } from '@hono/zod-openapi'
import {
  authorizationAuditEventPageSchema as authorizationAuditEventPageSchemaBase,
  authorizationAuditEventSchema as authorizationAuditEventSchemaBase,
  authorizationPermissionImpactSchema as authorizationPermissionImpactSchemaBase,
  authorizationPermissionSchema as authorizationPermissionSchemaBase,
  authorizationRoleCatalogSchema as authorizationRoleCatalogSchemaBase,
  authorizationRoleImpactSchema as authorizationRoleImpactSchemaBase,
  authorizationRoleSchema as authorizationRoleSchemaBase,
  authorizationUserSchema as authorizationUserSchemaBase,
  currentPermissionsSchema as currentPermissionsSchemaBase,
} from '@starter/contracts'
import { nameSchema } from '@api/openapi/name-schema.js'

export {
  authorizationAuditQuerySchema,
  authorizationPermissionParamsSchema,
  authorizationRoleCatalogQuerySchema,
  authorizationRoleParamsSchema,
  authorizationUserParamsSchema,
} from '@starter/contracts'

export const authorizationUserSchema = nameSchema(authorizationUserSchemaBase, 'AuthorizationUser')

export const authorizationPermissionSchema = nameSchema(authorizationPermissionSchemaBase, 'AuthorizationPermission')

export const authorizationRoleSchema = nameSchema(authorizationRoleSchemaBase, 'AuthorizationRole')

export const authorizationRoleImpactSchema = nameSchema(authorizationRoleImpactSchemaBase, 'AuthorizationRoleImpact')

export const authorizationPermissionImpactSchema = nameSchema(
  authorizationPermissionImpactSchemaBase,
  'AuthorizationPermissionImpact',
)

export const currentPermissionsSchema = nameSchema(currentPermissionsSchemaBase, 'CurrentPermissions')

export const authorizationUsersSchema = z.array(authorizationUserSchema).openapi('AuthorizationUsers')

export const authorizationRoleCatalogSchema = nameSchema(authorizationRoleCatalogSchemaBase, 'AuthorizationRoleCatalog')

export const authorizationAuditEventSchema = nameSchema(authorizationAuditEventSchemaBase, 'AuthorizationAuditEvent')

export const authorizationAuditEventPageSchema = nameSchema(
  authorizationAuditEventPageSchemaBase,
  'AuthorizationAuditEventPage',
)
