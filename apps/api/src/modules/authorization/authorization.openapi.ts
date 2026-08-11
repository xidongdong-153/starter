import { z } from "@hono/zod-openapi";
import {
  AuditActions,
  RoleLifecycleAuditActions,
  UserRolesAuditActions,
  auditPermissionKeysPayloadSchema,
  auditRoleCreatedAfterSchema,
  auditRoleCreatedBeforeSchema,
  auditRoleKeysPayloadSchema,
  auditRoleLifecyclePayloadSchema,
  auditRoleMetadataPayloadSchema,
  authorizationAuditQuerySchema,
  permissionSchema,
  roleCatalogStatusSchema,
  roleKeySchema,
} from "@starter/contracts";
import { isoDateTimeSchema } from "@api/openapi/responses.js";

const authorizationUserSchema = z
  .object({
    id: z.uuidv7(),
    name: z.string(),
    email: z.email(),
    roleKeys: z.array(roleKeySchema),
  })
  .openapi("AuthorizationUser");

const authorizationPermissionSchema = z
  .object({
    key: permissionSchema,
    resource: z.string(),
    action: z.string(),
    description: z.string().nullable(),
  })
  .openapi("AuthorizationPermission");

const authorizationRoleSchema = z
  .object({
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
  .openapi("AuthorizationRole");

export const authorizationRoleImpactSchema = z
  .object({
    roleKey: roleKeySchema,
    assignedUserCount: z.number().int().min(0),
  })
  .openapi("AuthorizationRoleImpact");

export const authorizationPermissionImpactSchema = z
  .object({
    permissionKey: permissionSchema,
    roleKeys: z.array(roleKeySchema),
    affectedUserCount: z.number().int().min(0),
  })
  .openapi("AuthorizationPermissionImpact");

export const currentPermissionsSchema = z
  .object({
    roles: z.array(roleKeySchema),
    permissions: z.array(permissionSchema),
    version: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .openapi("CurrentPermissions");

export const authorizationUsersSchema = z
  .array(authorizationUserSchema)
  .openapi("AuthorizationUsers");

export const authorizationRoleCatalogSchema = z
  .object({
    roles: z.array(authorizationRoleSchema),
    permissions: z.array(authorizationPermissionSchema),
  })
  .openapi("AuthorizationRoleCatalog");

export const authorizationUserParamsSchema = z.object({
  userId: z.uuidv7(),
});

export const authorizationRoleParamsSchema = z.object({
  roleKey: roleKeySchema,
});

export const authorizationPermissionParamsSchema = z.object({
  permissionKey: permissionSchema,
});

export const authorizationRoleCatalogQuerySchema = z.object({
  status: roleCatalogStatusSchema.optional().default("active"),
});

const authorizationAuditEventBaseSchema = z.object({
  id: z.uuidv7(),
  actorType: z.enum(["user", "system"]),
  actorId: z.string(),
  targetId: z.string(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});

const authorizationAuditEventSchema = z
  .union([
    authorizationAuditEventBaseSchema.extend({
      action: z.enum(UserRolesAuditActions),
      targetType: z.literal("user"),
      before: auditRoleKeysPayloadSchema,
      after: auditRoleKeysPayloadSchema,
    }),
    authorizationAuditEventBaseSchema.extend({
      action: z.literal(AuditActions.ROLE_PERMISSIONS_REPLACED),
      targetType: z.literal("role"),
      before: auditPermissionKeysPayloadSchema,
      after: auditPermissionKeysPayloadSchema,
    }),
    authorizationAuditEventBaseSchema.extend({
      action: z.literal(AuditActions.ROLE_CREATED),
      targetType: z.literal("role"),
      before: auditRoleCreatedBeforeSchema,
      after: auditRoleCreatedAfterSchema,
    }),
    authorizationAuditEventBaseSchema.extend({
      action: z.literal(AuditActions.ROLE_UPDATED),
      targetType: z.literal("role"),
      before: auditRoleMetadataPayloadSchema,
      after: auditRoleMetadataPayloadSchema,
    }),
    authorizationAuditEventBaseSchema.extend({
      action: z.enum(RoleLifecycleAuditActions),
      targetType: z.literal("role"),
      before: auditRoleLifecyclePayloadSchema,
      after: auditRoleLifecyclePayloadSchema,
    }),
  ])
  .openapi("AuthorizationAuditEvent");

export const authorizationAuditEventPageSchema = z
  .object({
    items: z.array(authorizationAuditEventSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  })
  .openapi("AuthorizationAuditEventPage");

export {
  authorizationAuditQuerySchema,
  authorizationPermissionSchema,
  authorizationRoleSchema,
  authorizationUserSchema,
};
