import type { InferSelectModel } from "drizzle-orm";
import type { AppDatabase } from "@api/infra/db/client.js";
import type { Permission } from "@starter/contracts";
import { PermissionKeys, RoleKeys } from "@starter/contracts";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  permissions,
  rolePermissions,
  roles,
  user,
  userRoles,
} from "@api/infra/db/schema/index.js";

const registeredPermissions = Object.values(PermissionKeys);

export type AuthorizationUserRecord = Pick<
  InferSelectModel<typeof user>,
  "id" | "name" | "email"
>;
export type AuthorizationRoleRecord = InferSelectModel<typeof roles>;
export type AuthorizationPermissionRecord = InferSelectModel<
  typeof permissions
>;

export interface UserRoleRecord {
  userId: string;
  roleKey: string;
}

export interface RolePermissionRecord {
  roleKey: string;
  permissionKey: string;
}

export type ReplaceUserRolesResult =
  | { kind: "ok"; user: AuthorizationUserRecord; roleKeys: string[] }
  | { kind: "user-not-found" }
  | { kind: "invalid-role-keys"; invalidKeys: string[] };

export type ReplaceRolePermissionsResult =
  | {
      kind: "ok";
      role: AuthorizationRoleRecord;
      permissionKeys: string[];
    }
  | { kind: "role-not-found" }
  | { kind: "invalid-permission-keys"; invalidKeys: string[] };

export type BootstrapAdminResult =
  | { kind: "ok"; user: AuthorizationUserRecord }
  | { kind: "user-not-found" }
  | { kind: "admin-role-not-found" };

export function createAuthorizationRepository(db: AppDatabase) {
  async function findCurrentAuthorization(userId: string) {
    const roleRows = await db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(and(eq(userRoles.userId, userId), isNull(roles.archivedAt)))
      .orderBy(asc(roles.key));

    const permissionRows = roleRows.some((role) => role.key === RoleKeys.ADMIN)
      ? await db
          .select({ key: permissions.key })
          .from(permissions)
          .where(
            and(
              isNull(permissions.archivedAt),
              inArray(permissions.key, registeredPermissions),
            ),
          )
          .orderBy(asc(permissions.key))
      : await db
          .selectDistinct({ key: permissions.key })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
          .innerJoin(
            permissions,
            eq(rolePermissions.permissionId, permissions.id),
          )
          .where(
            and(
              eq(userRoles.userId, userId),
              isNull(roles.archivedAt),
              isNull(permissions.archivedAt),
              inArray(permissions.key, registeredPermissions),
            ),
          )
          .orderBy(asc(permissions.key));

    return {
      roleKeys: roleRows.map((role) => role.key),
      permissionKeys: permissionRows.map((permission) => permission.key),
    };
  }

  async function hasPermission(
    userId: string,
    permission: Permission,
  ): Promise<boolean> {
    const adminRole = await db
      .select({ id: roles.id })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(roles.key, RoleKeys.ADMIN),
          isNull(roles.archivedAt),
        ),
      )
      .get();

    if (adminRole) {
      const activePermission = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(eq(permissions.key, permission), isNull(permissions.archivedAt)),
        )
        .get();
      return Boolean(activePermission);
    }

    const relation = await db
      .select({ permissionId: permissions.id })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(permissions.key, permission),
          isNull(roles.archivedAt),
          isNull(permissions.archivedAt),
        ),
      )
      .get();
    return Boolean(relation);
  }

  async function listUsers() {
    const users = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .orderBy(asc(user.email), asc(user.id));
    const roleAssignments = await db
      .select({ userId: userRoles.userId, roleKey: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(isNull(roles.archivedAt))
      .orderBy(asc(userRoles.userId), asc(roles.key));
    return { users, roleAssignments };
  }

  async function listRoleCatalog() {
    const activeRoles = await db
      .select()
      .from(roles)
      .where(isNull(roles.archivedAt))
      .orderBy(asc(roles.key));
    const activePermissions = await db
      .select()
      .from(permissions)
      .where(
        and(
          isNull(permissions.archivedAt),
          inArray(permissions.key, registeredPermissions),
        ),
      )
      .orderBy(asc(permissions.key));
    const permissionAssignments = await db
      .select({
        roleKey: roles.key,
        permissionKey: permissions.key,
      })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          isNull(roles.archivedAt),
          isNull(permissions.archivedAt),
          inArray(permissions.key, registeredPermissions),
        ),
      )
      .orderBy(asc(roles.key), asc(permissions.key));
    return { activeRoles, activePermissions, permissionAssignments };
  }

  function replaceUserRoles(
    userId: string,
    roleKeys: string[],
    assignedBy: string,
  ): ReplaceUserRolesResult {
    return db.transaction((tx) => {
      const targetUser = tx
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .get();
      if (!targetUser) return { kind: "user-not-found" };

      const activeRoles = roleKeys.length
        ? tx
            .select({ id: roles.id, key: roles.key })
            .from(roles)
            .where(and(inArray(roles.key, roleKeys), isNull(roles.archivedAt)))
            .all()
        : [];
      const activeRoleKeys = new Set(activeRoles.map((role) => role.key));
      const invalidKeys = roleKeys.filter((key) => !activeRoleKeys.has(key));
      if (invalidKeys.length > 0) {
        return { kind: "invalid-role-keys", invalidKeys };
      }

      tx.delete(userRoles).where(eq(userRoles.userId, userId)).run();
      tx.insert(userRoles)
        .values(
          activeRoles.map((role) => ({
            userId,
            roleId: role.id,
            assignedAt: new Date(),
            assignedBy,
          })),
        )
        .run();

      return {
        kind: "ok",
        user: targetUser,
        roleKeys: [...activeRoleKeys].sort(),
      };
    });
  }

  function replaceRolePermissions(
    roleKey: string,
    permissionKeys: Permission[],
    assignedBy: string,
  ): ReplaceRolePermissionsResult {
    return db.transaction((tx) => {
      const targetRole = tx
        .select()
        .from(roles)
        .where(and(eq(roles.key, roleKey), isNull(roles.archivedAt)))
        .get();
      if (!targetRole) return { kind: "role-not-found" };

      const activePermissions = permissionKeys.length
        ? tx
            .select({ id: permissions.id, key: permissions.key })
            .from(permissions)
            .where(
              and(
                inArray(permissions.key, permissionKeys),
                isNull(permissions.archivedAt),
              ),
            )
            .all()
        : [];
      const activePermissionKeys = new Set(
        activePermissions.map((permission) => permission.key),
      );
      const invalidKeys = permissionKeys.filter(
        (key) => !activePermissionKeys.has(key),
      );
      if (invalidKeys.length > 0) {
        return { kind: "invalid-permission-keys", invalidKeys };
      }

      tx.delete(rolePermissions)
        .where(eq(rolePermissions.roleId, targetRole.id))
        .run();
      if (activePermissions.length > 0) {
        tx.insert(rolePermissions)
          .values(
            activePermissions.map((permission) => ({
              roleId: targetRole.id,
              permissionId: permission.id,
              assignedAt: new Date(),
              assignedBy,
            })),
          )
          .run();
      }

      return {
        kind: "ok",
        role: targetRole,
        permissionKeys: [...activePermissionKeys].sort(),
      };
    });
  }

  function bootstrapAdminByEmail(email: string): BootstrapAdminResult {
    return db.transaction((tx) => {
      const targetUser = tx
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.email, email))
        .get();
      if (!targetUser) return { kind: "user-not-found" };

      const adminRole = tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.key, RoleKeys.ADMIN), isNull(roles.archivedAt)))
        .get();
      if (!adminRole) return { kind: "admin-role-not-found" };

      tx.delete(userRoles).where(eq(userRoles.userId, targetUser.id)).run();
      tx.insert(userRoles)
        .values({
          userId: targetUser.id,
          roleId: adminRole.id,
          assignedAt: new Date(),
          assignedBy: null,
        })
        .run();
      return { kind: "ok", user: targetUser };
    });
  }

  return {
    bootstrapAdminByEmail,
    findCurrentAuthorization,
    hasPermission,
    listRoleCatalog,
    listUsers,
    replaceRolePermissions,
    replaceUserRoles,
  };
}

export type AuthorizationRepository = ReturnType<
  typeof createAuthorizationRepository
>;
