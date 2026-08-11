import type {
  AuthorizationAuditEventPage,
  AuthorizationAuditQuery,
  AuthorizationPermissionImpact,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationRoleImpact,
  AuthorizationUser,
  CreateRoleInput,
  CurrentPermissions,
  Permission,
  ReplaceRolePermissionsInput,
  ReplaceUserRolesInput,
  RoleCatalogStatus,
  UpdateRoleInput,
} from "@starter/contracts";
import type {
  AuthorizationRepository,
  AuthorizationWriteContext,
} from "./authorization.repository.js";
import { ApiErrorCodes, RoleKeys } from "@starter/contracts";
import { AppError } from "@api/shared/app-error.js";
import {
  toAuthorizationAuditEvent,
  toAuthorizationPermissionImpact,
  toAuthorizationRole,
  toAuthorizationRoleCatalog,
  toAuthorizationRoleImpact,
  toAuthorizationUser,
  toAuthorizationUsers,
  toCurrentPermissions,
} from "./authorization.presenter.js";

export function createAuthorizationService(
  repository: AuthorizationRepository,
) {
  async function getCurrent(userId: string): Promise<CurrentPermissions> {
    const authorization = await repository.findCurrentAuthorization(userId);
    return toCurrentPermissions(
      authorization.roleKeys,
      authorization.permissionKeys,
    );
  }

  async function listUsers(): Promise<AuthorizationUser[]> {
    const result = await repository.listUsers();
    return toAuthorizationUsers(result.users, result.roleAssignments);
  }

  async function listRoles(
    status: RoleCatalogStatus = "active",
  ): Promise<AuthorizationRoleCatalog> {
    const result = await repository.listRoleCatalog(status);
    return toAuthorizationRoleCatalog(
      result.activeRoles,
      result.activePermissions,
      result.permissionAssignments,
    );
  }

  function throwActorNotPlatformAdmin(): never {
    throw new AppError(
      ApiErrorCodes.AUTH_FORBIDDEN,
      "只有平台管理员可以修改授权关系",
      403,
    );
  }

  function createRole(
    context: AuthorizationWriteContext,
    input: CreateRoleInput,
  ): AuthorizationRole {
    const result = repository.createRole(input, context);
    if (result.kind === "invalid-permission-keys") {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "权限不存在或已归档",
        400,
        { invalidKeys: result.invalidKeys },
      );
    }
    if (result.kind === "actor-not-platform-admin") {
      throwActorNotPlatformAdmin();
    }
    if (result.kind === "role-key-conflict") {
      throw new AppError(
        ApiErrorCodes.AUTH_ROLE_KEY_CONFLICT,
        "角色 key 已被占用",
        409,
      );
    }
    return toAuthorizationRole(result.role, result.permissionKeys);
  }

  function updateRole(
    context: AuthorizationWriteContext,
    roleKey: string,
    input: UpdateRoleInput,
  ): AuthorizationRole {
    const result = repository.updateRoleMetadata(roleKey, input, context);
    if (result.kind === "role-not-found") {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "角色不存在", 404);
    }
    if (result.kind === "actor-not-platform-admin") {
      throwActorNotPlatformAdmin();
    }
    if (result.kind === "system-role") {
      throw new AppError(ApiErrorCodes.AUTH_FORBIDDEN, "不能修改系统角色", 403);
    }
    return toAuthorizationRole(result.role, result.permissionKeys);
  }

  function archiveRole(
    context: AuthorizationWriteContext,
    roleKey: string,
  ): AuthorizationRole {
    const result = repository.archiveRole(roleKey, context);
    if (result.kind === "role-not-found") {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "角色不存在", 404);
    }
    if (result.kind === "actor-not-platform-admin") {
      throwActorNotPlatformAdmin();
    }
    if (result.kind === "system-role") {
      throw new AppError(ApiErrorCodes.AUTH_FORBIDDEN, "不能归档系统角色", 403);
    }
    if (result.kind === "role-in-use") {
      throw new AppError(
        ApiErrorCodes.AUTH_ROLE_IN_USE,
        "角色仍有用户分配，不能归档",
        409,
        { assignedUserCount: result.assignedUserCount },
      );
    }
    return toAuthorizationRole(result.role, result.permissionKeys);
  }

  function restoreRole(
    context: AuthorizationWriteContext,
    roleKey: string,
  ): AuthorizationRole {
    const result = repository.restoreRole(roleKey, context);
    if (result.kind === "role-not-found") {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "角色不存在", 404);
    }
    if (result.kind === "actor-not-platform-admin") {
      throwActorNotPlatformAdmin();
    }
    if (result.kind === "system-role") {
      throw new AppError(ApiErrorCodes.AUTH_FORBIDDEN, "不能恢复系统角色", 403);
    }
    return toAuthorizationRole(result.role, result.permissionKeys);
  }

  async function getRoleImpact(
    roleKey: string,
  ): Promise<AuthorizationRoleImpact> {
    const result = await repository.getRoleImpact(roleKey);
    if (!result) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "角色不存在", 404);
    }
    return toAuthorizationRoleImpact(result.role.key, result.assignedUserCount);
  }

  async function getPermissionImpact(
    permissionKey: Permission,
  ): Promise<AuthorizationPermissionImpact> {
    const result = await repository.getPermissionImpact(permissionKey);
    if (!result) {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "权限不存在", 404);
    }
    return toAuthorizationPermissionImpact(
      permissionKey,
      result.roleKeys,
      result.affectedUserCount,
    );
  }

  function replaceUserRoles(
    context: AuthorizationWriteContext,
    targetUserId: string,
    input: ReplaceUserRolesInput,
  ): AuthorizationUser {
    if (context.actorId === targetUserId) {
      throw new AppError(
        ApiErrorCodes.AUTH_FORBIDDEN,
        "不能修改自己的角色",
        403,
      );
    }
    if (input.roleKeys.length === 0) {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "用户至少需要一个活动角色",
        400,
      );
    }

    const result = repository.replaceUserRoles(
      targetUserId,
      input.roleKeys,
      context,
    );
    if (result.kind === "user-not-found") {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "用户不存在", 404);
    }
    if (result.kind === "invalid-role-keys") {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "角色不存在或已归档",
        400,
        { invalidKeys: result.invalidKeys },
      );
    }
    if (result.kind === "actor-not-platform-admin") {
      throw new AppError(
        ApiErrorCodes.AUTH_FORBIDDEN,
        "只有平台管理员可以修改授权关系",
        403,
      );
    }
    if (result.kind === "last-platform-admin") {
      throw new AppError(
        ApiErrorCodes.AUTH_LAST_PLATFORM_ADMIN,
        "至少需要保留一个平台管理员",
        409,
      );
    }
    return toAuthorizationUser(result.user, result.roleKeys);
  }

  function replaceRolePermissions(
    context: AuthorizationWriteContext,
    roleKey: string,
    input: ReplaceRolePermissionsInput,
  ): AuthorizationRole {
    if (roleKey === RoleKeys.ADMIN) {
      throw new AppError(
        ApiErrorCodes.AUTH_FORBIDDEN,
        "不能修改 admin 角色的权限",
        403,
      );
    }

    const result = repository.replaceRolePermissions(
      roleKey,
      input.permissionKeys,
      context,
    );
    if (result.kind === "role-not-found") {
      throw new AppError(ApiErrorCodes.COMMON_NOT_FOUND, "角色不存在", 404);
    }
    if (result.kind === "invalid-permission-keys") {
      throw new AppError(
        ApiErrorCodes.COMMON_INVALID_REQUEST,
        "权限不存在或已归档",
        400,
        { invalidKeys: result.invalidKeys },
      );
    }
    if (result.kind === "actor-not-platform-admin") {
      throw new AppError(
        ApiErrorCodes.AUTH_FORBIDDEN,
        "只有平台管理员可以修改授权关系",
        403,
      );
    }
    return toAuthorizationRole(result.role, result.permissionKeys);
  }

  async function listAuditEvents(
    query: AuthorizationAuditQuery,
  ): Promise<AuthorizationAuditEventPage> {
    const result = await repository.listAuditEvents(query);
    return {
      items: result.items.map(toAuthorizationAuditEvent),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  return {
    archiveRole,
    createRole,
    getCurrent,
    getPermissionImpact,
    getRoleImpact,
    listAuditEvents,
    listRoles,
    listUsers,
    replaceRolePermissions,
    replaceUserRoles,
    restoreRole,
    updateRole,
  };
}

export type AuthorizationService = ReturnType<
  typeof createAuthorizationService
>;
