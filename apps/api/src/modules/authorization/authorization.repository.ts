import type { InferSelectModel } from "drizzle-orm";
import type { AppDatabase } from "@api/infra/db/client.js";
import type { Permission } from "@starter/contracts";
import { PermissionKeys, RoleKeys } from "@starter/contracts";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import {
  permissions,
  rolePermissions,
  roles,
  user,
  userRoles,
} from "@api/infra/db/schema/index.js";

const registeredPermissions = Object.values(PermissionKeys);

type TxLike = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

/**
 * 授权写操作的执行上下文。
 *
 * `actorType` 为 `system` 时跳过平台管理员校验，`assignedBy` 写 null，
 * 对应 bootstrap 脚本这类没有浏览器 actor 的入口。
 * `requestId` 当前不落库，为后续审计表预留。
 */
export interface AuthorizationWriteContext {
  actorType: "user" | "system";
  actorId: string;
  requestId: string | null;
}

function resolveAssignedBy(context: AuthorizationWriteContext): string | null {
  return context.actorType === "user" ? context.actorId : null;
}

/** 判断用户是否关联未归档的 admin 角色。必须在写 transaction 内调用。 */
function isActivePlatformAdmin(tx: TxLike, userId: string): boolean {
  return Boolean(
    tx
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
      .get(),
  );
}

/** 统计现存 user 中关联未归档 admin 角色的数量。 */
function countActivePlatformAdmins(tx: TxLike): number {
  const row = tx
    .select({ value: count() })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(user, eq(userRoles.userId, user.id))
    .where(and(eq(roles.key, RoleKeys.ADMIN), isNull(roles.archivedAt)))
    .get();

  return row?.value ?? 0;
}

/** 比较两个已排序的 key 集合是否相同。 */
function sameKeys(before: string[], after: string[]): boolean {
  return (
    before.length === after.length &&
    before.every((key, index) => key === after[index])
  );
}

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
  | { kind: "invalid-role-keys"; invalidKeys: string[] }
  | { kind: "actor-not-platform-admin" }
  | { kind: "last-platform-admin" };

export type ReplaceRolePermissionsResult =
  | {
      kind: "ok";
      role: AuthorizationRoleRecord;
      permissionKeys: string[];
    }
  | { kind: "role-not-found" }
  | { kind: "invalid-permission-keys"; invalidKeys: string[] }
  | { kind: "actor-not-platform-admin" };

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
    context: AuthorizationWriteContext,
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

      // actor 校验在 transaction 内重新读库，避开并发撤权时的过期快照。
      if (
        context.actorType === "user" &&
        !isActivePlatformAdmin(tx, context.actorId)
      ) {
        return { kind: "actor-not-platform-admin" };
      }

      const beforeRoleKeys = tx
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId))
        .orderBy(asc(roles.key))
        .all()
        .map((role) => role.key);
      const afterRoleKeys = [...activeRoleKeys].sort();

      // 幂等短路必须在 actor 校验之后，否则无权 actor 能提交相同值绕过校验。
      if (sameKeys(beforeRoleKeys, afterRoleKeys)) {
        return { kind: "ok", user: targetUser, roleKeys: afterRoleKeys };
      }

      const removesAdmin =
        beforeRoleKeys.includes(RoleKeys.ADMIN) &&
        !afterRoleKeys.includes(RoleKeys.ADMIN);
      if (removesAdmin && countActivePlatformAdmins(tx) <= 1) {
        return { kind: "last-platform-admin" };
      }

      tx.delete(userRoles).where(eq(userRoles.userId, userId)).run();
      tx.insert(userRoles)
        .values(
          activeRoles.map((role) => ({
            userId,
            roleId: role.id,
            assignedAt: new Date(),
            assignedBy: resolveAssignedBy(context),
          })),
        )
        .run();

      return { kind: "ok", user: targetUser, roleKeys: afterRoleKeys };
    });
  }

  function replaceRolePermissions(
    roleKey: string,
    permissionKeys: Permission[],
    context: AuthorizationWriteContext,
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

      if (
        context.actorType === "user" &&
        !isActivePlatformAdmin(tx, context.actorId)
      ) {
        return { kind: "actor-not-platform-admin" };
      }

      const beforePermissionKeys = tx
        .select({ key: permissions.key })
        .from(rolePermissions)
        .innerJoin(
          permissions,
          eq(rolePermissions.permissionId, permissions.id),
        )
        .where(eq(rolePermissions.roleId, targetRole.id))
        .orderBy(asc(permissions.key))
        .all()
        .map((permission) => permission.key);
      const afterPermissionKeys = [...activePermissionKeys].sort();

      if (sameKeys(beforePermissionKeys, afterPermissionKeys)) {
        return {
          kind: "ok",
          role: targetRole,
          permissionKeys: afterPermissionKeys,
        };
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
              assignedBy: resolveAssignedBy(context),
            })),
          )
          .run();
      }

      return {
        kind: "ok",
        role: targetRole,
        permissionKeys: afterPermissionKeys,
      };
    });
  }

  function bootstrapAdminByEmail(
    email: string,
    context: AuthorizationWriteContext,
  ): BootstrapAdminResult {
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

      const beforeRoleKeys = tx
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, targetUser.id))
        .orderBy(asc(roles.key))
        .all()
        .map((role) => role.key);

      if (sameKeys(beforeRoleKeys, [RoleKeys.ADMIN])) {
        return { kind: "ok", user: targetUser };
      }

      tx.delete(userRoles).where(eq(userRoles.userId, targetUser.id)).run();
      tx.insert(userRoles)
        .values({
          userId: targetUser.id,
          roleId: adminRole.id,
          assignedAt: new Date(),
          assignedBy: resolveAssignedBy(context),
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
