import { z } from "@hono/zod-openapi";
import { permissionSchema, roleKeySchema } from "@starter/contracts";

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
    permissionsEditable: z.boolean(),
    permissionKeys: z.array(permissionSchema),
  })
  .openapi("AuthorizationRole");

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

export {
  authorizationPermissionSchema,
  authorizationRoleSchema,
  authorizationUserSchema,
};
