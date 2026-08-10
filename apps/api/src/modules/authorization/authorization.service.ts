import type {
  AuthorizationAuditEventPage,
  AuthorizationAuditQuery,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationUser,
  CurrentPermissions,
  ReplaceRolePermissionsInput,
  ReplaceUserRolesInput,
} from "@starter/contracts";
import type {
  AuthorizationRepository,
  AuthorizationWriteContext,
} from "./authorization.repository.js";
import { ApiErrorCodes, RoleKeys } from "@starter/contracts";
import { AppError } from "@api/shared/app-error.js";
import {
  toAuthorizationAuditEvent,
  toAuthorizationRole,
  toAuthorizationRoleCatalog,
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

  async function listRoles(): Promise<AuthorizationRoleCatalog> {
    const result = await repository.listRoleCatalog();
    return toAuthorizationRoleCatalog(
      result.activeRoles,
      result.activePermissions,
      result.permissionAssignments,
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
    getCurrent,
    listAuditEvents,
    listRoles,
    listUsers,
    replaceRolePermissions,
    replaceUserRoles,
  };
}

export type AuthorizationService = ReturnType<
  typeof createAuthorizationService
>;
