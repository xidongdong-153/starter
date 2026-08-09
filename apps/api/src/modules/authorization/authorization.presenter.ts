import type {
  AuthorizationPermission,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationUser,
  CurrentPermissions,
  Permission,
} from "@starter/contracts";
import type {
  AuthorizationPermissionRecord,
  AuthorizationRoleRecord,
  AuthorizationUserRecord,
  RolePermissionRecord,
  UserRoleRecord,
} from "./authorization.repository.js";
import { RoleKeys, permissionSchema } from "@starter/contracts";
import { createHash } from "node:crypto";

function toPermissions(permissionKeys: string[]): Permission[] {
  return [...new Set(permissionKeys)]
    .sort()
    .map((permission) => permissionSchema.parse(permission));
}

export function toCurrentPermissions(
  roleKeys: string[],
  permissionKeys: string[],
): CurrentPermissions {
  const roles = [...new Set(roleKeys)].sort();
  const permissions = toPermissions(permissionKeys);
  const version = createHash("sha256")
    .update(JSON.stringify({ roles, permissions }))
    .digest("hex")
    .slice(0, 16);
  return { roles, permissions, version };
}

export function toAuthorizationUser(
  user: AuthorizationUserRecord,
  roleKeys: string[],
): AuthorizationUser {
  return { ...user, roleKeys: [...new Set(roleKeys)].sort() };
}

export function toAuthorizationUsers(
  users: AuthorizationUserRecord[],
  assignments: UserRoleRecord[],
): AuthorizationUser[] {
  const roleKeysByUser = new Map<string, string[]>();
  for (const assignment of assignments) {
    const roleKeys = roleKeysByUser.get(assignment.userId) ?? [];
    roleKeys.push(assignment.roleKey);
    roleKeysByUser.set(assignment.userId, roleKeys);
  }
  return users.map((user) =>
    toAuthorizationUser(user, roleKeysByUser.get(user.id) ?? []),
  );
}

export function toAuthorizationRole(
  role: AuthorizationRoleRecord,
  permissionKeys: string[],
): AuthorizationRole {
  return {
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionsEditable: role.key !== RoleKeys.ADMIN,
    permissionKeys: toPermissions(permissionKeys),
  };
}

export function toAuthorizationRoleCatalog(
  roles: AuthorizationRoleRecord[],
  permissions: AuthorizationPermissionRecord[],
  assignments: RolePermissionRecord[],
): AuthorizationRoleCatalog {
  const permissionKeysByRole = new Map<string, string[]>();
  for (const assignment of assignments) {
    const permissionKeys = permissionKeysByRole.get(assignment.roleKey) ?? [];
    permissionKeys.push(assignment.permissionKey);
    permissionKeysByRole.set(assignment.roleKey, permissionKeys);
  }

  const activePermissionKeys = permissions.map((permission) => permission.key);
  return {
    roles: roles.map((role) =>
      toAuthorizationRole(
        role,
        role.key === RoleKeys.ADMIN
          ? activePermissionKeys
          : (permissionKeysByRole.get(role.key) ?? []),
      ),
    ),
    permissions: permissions.map((permission): AuthorizationPermission => ({
      key: permissionSchema.parse(permission.key),
      resource: permission.resource,
      action: permission.action,
      description: permission.description,
    })),
  };
}
