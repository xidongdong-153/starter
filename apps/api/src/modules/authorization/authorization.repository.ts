import type { InferSelectModel } from "drizzle-orm";
import type { AppDatabase } from "@api/infra/db/client.js";
import type {
  AuthorizationAuditQuery,
  Permission,
  RoleCatalogStatus,
} from "@starter/contracts";
import { AuditActions, PermissionKeys, RoleKeys } from "@starter/contracts";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
} from "drizzle-orm";
import {
  authorizationAuditEvents,
  permissions,
  rolePermissions,
  roles,
  user,
  userRoles,
} from "@api/infra/db/schema/index.js";
import { generateId } from "@api/shared/id.js";
import {
  insertAuditEvent,
  resolveUserRolesAction,
} from "./authorization.audit.js";

const registeredPermissions = Object.values(PermissionKeys);

type TxLike = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

/**
 * 授权写操作的执行上下文。
 *
 * `actorType` 为 `system` 时跳过平台管理员校验，`assignedBy` 写 null，
 * 对应 bootstrap 脚本这类没有浏览器 actor 的入口。
 * `requestId` 只写入审计事件，不进关系表。
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
export type AuthorizationAuditEventRecord = InferSelectModel<
  typeof authorizationAuditEvents
>;
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

export type CreateRoleResult =
  | { kind: "ok"; role: AuthorizationRoleRecord; permissionKeys: string[] }
  | { kind: "invalid-permission-keys"; invalidKeys: string[] }
  | { kind: "actor-not-platform-admin" }
  | { kind: "role-key-conflict" };

export type UpdateRoleResult =
  | { kind: "ok"; role: AuthorizationRoleRecord; permissionKeys: string[] }
  | { kind: "role-not-found" }
  | { kind: "system-role" }
  | { kind: "actor-not-platform-admin" };

export type ArchiveRoleResult =
  | { kind: "ok"; role: AuthorizationRoleRecord; permissionKeys: string[] }
  | { kind: "role-not-found" }
  | { kind: "system-role" }
  | { kind: "actor-not-platform-admin" }
  | { kind: "role-in-use"; assignedUserCount: number };

export type RestoreRoleResult =
  | { kind: "ok"; role: AuthorizationRoleRecord; permissionKeys: string[] }
  | { kind: "role-not-found" }
  | { kind: "system-role" }
  | { kind: "actor-not-platform-admin" };

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

  async function listRoleCatalog(status: RoleCatalogStatus = "active") {
    const statusCondition =
      status === "archived"
        ? isNotNull(roles.archivedAt)
        : isNull(roles.archivedAt);
    const activeRoles = await db
      .select()
      .from(roles)
      .where(statusCondition)
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
          statusCondition,
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

      insertAuditEvent(tx, {
        actorType: context.actorType,
        actorId: context.actorId,
        action: resolveUserRolesAction(beforeRoleKeys, afterRoleKeys),
        targetType: "user",
        targetId: userId,
        before: { roleKeys: beforeRoleKeys },
        after: { roleKeys: afterRoleKeys },
        requestId: context.requestId,
      });

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

      insertAuditEvent(tx, {
        actorType: context.actorType,
        actorId: context.actorId,
        action: AuditActions.ROLE_PERMISSIONS_REPLACED,
        targetType: "role",
        targetId: targetRole.key,
        before: { permissionKeys: beforePermissionKeys as Permission[] },
        after: { permissionKeys: afterPermissionKeys as Permission[] },
        requestId: context.requestId,
      });

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

      insertAuditEvent(tx, {
        actorType: context.actorType,
        actorId: context.actorId,
        action: resolveUserRolesAction(beforeRoleKeys, [RoleKeys.ADMIN]),
        targetType: "user",
        targetId: targetUser.id,
        before: { roleKeys: beforeRoleKeys },
        after: { roleKeys: [RoleKeys.ADMIN] },
        requestId: context.requestId,
      });

      return { kind: "ok", user: targetUser };
    });
  }

  /** 读取角色当前 permission key 集合，排序后返回。 */
  function readRolePermissionKeys(tx: TxLike, roleId: string): string[] {
    return tx
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId))
      .orderBy(asc(permissions.key))
      .all()
      .map((permission) => permission.key);
  }

  /** 统计与角色关联且仍存在的用户数。归档提交前必须在写 transaction 内重查。 */
  function countAssignedUsers(tx: TxLike, roleId: string): number {
    const row = tx
      .select({ value: countDistinct(user.id) })
      .from(userRoles)
      .innerJoin(user, eq(userRoles.userId, user.id))
      .where(eq(userRoles.roleId, roleId))
      .get();
    return row?.value ?? 0;
  }

  function createRole(
    input: {
      key: string;
      name: string;
      description: string | null;
      permissionKeys: Permission[];
    },
    context: AuthorizationWriteContext,
  ): CreateRoleResult {
    return db.transaction((tx) => {
      const activePermissions = input.permissionKeys.length
        ? tx
            .select({ id: permissions.id, key: permissions.key })
            .from(permissions)
            .where(
              and(
                inArray(permissions.key, input.permissionKeys),
                isNull(permissions.archivedAt),
              ),
            )
            .all()
        : [];
      const activePermissionKeys = new Set(
        activePermissions.map((permission) => permission.key),
      );
      const invalidKeys = input.permissionKeys.filter(
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

      // key 冲突检查覆盖归档角色：key 是稳定身份，归档不释放。
      const existing = tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, input.key))
        .get();
      if (existing) return { kind: "role-key-conflict" };

      const now = new Date();
      const role = {
        id: generateId(),
        key: input.key,
        name: input.name,
        description: input.description,
        isSystem: false,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(roles).values(role).run();
      if (activePermissions.length > 0) {
        tx.insert(rolePermissions)
          .values(
            activePermissions.map((permission) => ({
              roleId: role.id,
              permissionId: permission.id,
              assignedAt: now,
              assignedBy: resolveAssignedBy(context),
            })),
          )
          .run();
      }

      const sortedPermissionKeys = [...activePermissionKeys].sort();
      insertAuditEvent(tx, {
        actorType: context.actorType,
        actorId: context.actorId,
        action: AuditActions.ROLE_CREATED,
        targetType: "role",
        targetId: role.key,
        before: { role: null },
        after: {
          role: {
            name: role.name,
            description: role.description,
            permissionKeys: sortedPermissionKeys as Permission[],
            archived: false,
          },
        },
        requestId: context.requestId,
      });

      return { kind: "ok", role, permissionKeys: sortedPermissionKeys };
    });
  }

  function updateRoleMetadata(
    roleKey: string,
    input: { name?: string; description?: string | null },
    context: AuthorizationWriteContext,
  ): UpdateRoleResult {
    return db.transaction((tx) => {
      const targetRole = tx
        .select()
        .from(roles)
        .where(and(eq(roles.key, roleKey), isNull(roles.archivedAt)))
        .get();
      if (!targetRole) return { kind: "role-not-found" };

      if (
        context.actorType === "user" &&
        !isActivePlatformAdmin(tx, context.actorId)
      ) {
        return { kind: "actor-not-platform-admin" };
      }
      if (targetRole.isSystem) return { kind: "system-role" };

      const permissionKeys = readRolePermissionKeys(tx, targetRole.id);
      const before = {
        name: targetRole.name,
        description: targetRole.description,
      };
      const after = {
        name: input.name ?? targetRole.name,
        description:
          input.description === undefined
            ? targetRole.description
            : input.description,
      };
      if (
        before.name === after.name &&
        before.description === after.description
      ) {
        return { kind: "ok", role: targetRole, permissionKeys };
      }

      const updatedAt = new Date();
      tx.update(roles)
        .set({
          name: after.name,
          description: after.description,
          updatedAt,
        })
        .where(eq(roles.id, targetRole.id))
        .run();

      insertAuditEvent(tx, {
        actorType: context.actorType,
        actorId: context.actorId,
        action: AuditActions.ROLE_UPDATED,
        targetType: "role",
        targetId: targetRole.key,
        before,
        after,
        requestId: context.requestId,
      });

      return {
        kind: "ok",
        role: {
          ...targetRole,
          name: after.name,
          description: after.description,
          updatedAt,
        },
        permissionKeys,
      };
    });
  }

  function archiveRole(
    roleKey: string,
    context: AuthorizationWriteContext,
  ): ArchiveRoleResult {
    return db.transaction((tx) => {
      const targetRole = tx
        .select()
        .from(roles)
        .where(eq(roles.key, roleKey))
        .get();
      if (!targetRole) return { kind: "role-not-found" };

      if (
        context.actorType === "user" &&
        !isActivePlatformAdmin(tx, context.actorId)
      ) {
        return { kind: "actor-not-platform-admin" };
      }
      if (targetRole.isSystem) return { kind: "system-role" };

      const permissionKeys = readRolePermissionKeys(tx, targetRole.id);
      if (targetRole.archivedAt !== null) {
        return { kind: "ok", role: targetRole, permissionKeys };
      }

      const assignedUserCount = countAssignedUsers(tx, targetRole.id);
      if (assignedUserCount > 0) {
        return { kind: "role-in-use", assignedUserCount };
      }

      const archivedAt = new Date();
      tx.update(roles)
        .set({ archivedAt, updatedAt: archivedAt })
        .where(eq(roles.id, targetRole.id))
        .run();

      insertAuditEvent(tx, {
        actorType: context.actorType,
        actorId: context.actorId,
        action: AuditActions.ROLE_ARCHIVED,
        targetType: "role",
        targetId: targetRole.key,
        before: { archived: false },
        after: { archived: true },
        requestId: context.requestId,
      });

      return {
        kind: "ok",
        role: { ...targetRole, archivedAt, updatedAt: archivedAt },
        permissionKeys,
      };
    });
  }

  function restoreRole(
    roleKey: string,
    context: AuthorizationWriteContext,
  ): RestoreRoleResult {
    return db.transaction((tx) => {
      const targetRole = tx
        .select()
        .from(roles)
        .where(eq(roles.key, roleKey))
        .get();
      if (!targetRole) return { kind: "role-not-found" };

      if (
        context.actorType === "user" &&
        !isActivePlatformAdmin(tx, context.actorId)
      ) {
        return { kind: "actor-not-platform-admin" };
      }
      if (targetRole.isSystem) return { kind: "system-role" };

      const permissionKeys = readRolePermissionKeys(tx, targetRole.id);
      if (targetRole.archivedAt === null) {
        return { kind: "ok", role: targetRole, permissionKeys };
      }

      const updatedAt = new Date();
      tx.update(roles)
        .set({ archivedAt: null, updatedAt })
        .where(eq(roles.id, targetRole.id))
        .run();

      insertAuditEvent(tx, {
        actorType: context.actorType,
        actorId: context.actorId,
        action: AuditActions.ROLE_RESTORED,
        targetType: "role",
        targetId: targetRole.key,
        before: { archived: true },
        after: { archived: false },
        requestId: context.requestId,
      });

      return {
        kind: "ok",
        role: { ...targetRole, archivedAt: null, updatedAt },
        permissionKeys,
      };
    });
  }

  /** 任意状态角色的分配用户数。只用于提示，写 transaction 内仍会重查。 */
  async function getRoleImpact(roleKey: string) {
    const targetRole = await db
      .select()
      .from(roles)
      .where(eq(roles.key, roleKey))
      .get();
    if (!targetRole) return null;

    const row = await db
      .select({ value: countDistinct(user.id) })
      .from(userRoles)
      .innerJoin(user, eq(userRoles.userId, user.id))
      .where(eq(userRoles.roleId, targetRole.id))
      .get();
    return { role: targetRole, assignedUserCount: row?.value ?? 0 };
  }

  /**
   * permission 的有效授权影响。
   * 除 role_permissions 关系外必须合并活动 admin 角色：
   * admin 对每个活动注册 permission 自动有效，与 findCurrentAuthorization 一致。
   */
  async function getPermissionImpact(permissionKey: Permission) {
    const permissionRow = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(eq(permissions.key, permissionKey), isNull(permissions.archivedAt)),
      )
      .get();
    if (!permissionRow) return null;

    const grantedRoles = await db
      .selectDistinct({ id: roles.id, key: roles.key })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .where(
        and(
          eq(rolePermissions.permissionId, permissionRow.id),
          isNull(roles.archivedAt),
        ),
      );
    const adminRole = await db
      .select({ id: roles.id, key: roles.key })
      .from(roles)
      .where(and(eq(roles.key, RoleKeys.ADMIN), isNull(roles.archivedAt)))
      .get();

    const rolesById = new Map(grantedRoles.map((role) => [role.id, role.key]));
    if (adminRole) rolesById.set(adminRole.id, adminRole.key);
    const roleIds = [...rolesById.keys()];

    const affectedRow = roleIds.length
      ? await db
          .select({ value: countDistinct(user.id) })
          .from(userRoles)
          .innerJoin(user, eq(userRoles.userId, user.id))
          .where(inArray(userRoles.roleId, roleIds))
          .get()
      : undefined;

    return {
      roleKeys: [...rolesById.values()],
      affectedUserCount: affectedRow?.value ?? 0,
    };
  }

  async function listAuditEvents(query: AuthorizationAuditQuery) {
    const conditions = [];
    if (query.action) {
      conditions.push(eq(authorizationAuditEvents.action, query.action));
    }
    if (query.actorId) {
      conditions.push(eq(authorizationAuditEvents.actorId, query.actorId));
    }
    if (query.targetId) {
      conditions.push(eq(authorizationAuditEvents.targetId, query.targetId));
    }
    if (query.from) {
      conditions.push(
        gte(authorizationAuditEvents.createdAt, new Date(query.from)),
      );
    }
    if (query.to) {
      conditions.push(
        lte(authorizationAuditEvents.createdAt, new Date(query.to)),
      );
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const countRow = await db
      .select({ value: count() })
      .from(authorizationAuditEvents)
      .where(whereClause)
      .get();

    // (created_at, id) 复合索引直接支撑这个排序，
    // 第二排序键避免相同时间戳跨页时重复或丢失。
    const items = await db
      .select()
      .from(authorizationAuditEvents)
      .where(whereClause)
      .orderBy(
        desc(authorizationAuditEvents.createdAt),
        desc(authorizationAuditEvents.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return { items, total: countRow?.value ?? 0 };
  }

  return {
    archiveRole,
    bootstrapAdminByEmail,
    createRole,
    findCurrentAuthorization,
    getPermissionImpact,
    getRoleImpact,
    hasPermission,
    listAuditEvents,
    listRoleCatalog,
    listUsers,
    replaceRolePermissions,
    replaceUserRoles,
    restoreRole,
    updateRoleMetadata,
  };
}

export type AuthorizationRepository = ReturnType<
  typeof createAuthorizationRepository
>;
