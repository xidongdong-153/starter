import type {
  AuthorizationAuditEvent,
  AuthorizationPermission,
  AuthorizationRole,
  AuthorizationRoleCatalog,
  AuthorizationUser,
  CurrentPermissions,
  Permission,
} from "@starter/contracts";
import type {
  AuthorizationAuditEventRecord,
  AuthorizationPermissionRecord,
  AuthorizationRoleRecord,
  AuthorizationUserRecord,
  RolePermissionRecord,
  UserRoleRecord,
} from "./authorization.repository.js";
import {
  ApiErrorCodes,
  AuditActions,
  RoleKeys,
  auditActionSchema,
  auditPermissionKeysPayloadSchema,
  auditRoleKeysPayloadSchema,
  permissionSchema,
} from "@starter/contracts";
import { AppError } from "@api/shared/app-error.js";
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

function corruptedAuditEvent(): AppError {
  return new AppError(
    ApiErrorCodes.SYSTEM_INTERNAL_ERROR,
    "审计事件数据损坏",
    500,
  );
}

/**
 * 解析并校验审计 payload。
 *
 * 这些 JSON 来自历史数据，schema 可能随版本变化，所以用 Zod 校验而不是类型断言。
 * `JSON.parse` 自己会抛 SyntaxError，一并转成 500：
 * 否则它会以未知异常冒到全局 error handler，多写一条 Pino error。
 */
function parseAuditJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw corruptedAuditEvent();
  }
}

function parseRoleKeysPayload(json: string) {
  const result = auditRoleKeysPayloadSchema.safeParse(parseAuditJson(json));
  if (!result.success) throw corruptedAuditEvent();
  return result.data;
}

function parsePermissionKeysPayload(json: string) {
  const result = auditPermissionKeysPayloadSchema.safeParse(
    parseAuditJson(json),
  );
  if (!result.success) throw corruptedAuditEvent();
  return result.data;
}

function parseActorType(value: string): "user" | "system" {
  if (value !== "user" && value !== "system") throw corruptedAuditEvent();
  return value;
}

function parseTargetType(value: string): "user" | "role" {
  if (value !== "user" && value !== "role") throw corruptedAuditEvent();
  return value;
}

export function toAuthorizationAuditEvent(
  record: AuthorizationAuditEventRecord,
): AuthorizationAuditEvent {
  const action = auditActionSchema.safeParse(record.action);
  if (!action.success) throw corruptedAuditEvent();

  const base = {
    id: record.id,
    actorType: parseActorType(record.actorType),
    actorId: record.actorId,
    targetId: record.targetId,
    reason: record.reason,
    requestId: record.requestId,
    createdAt: record.createdAt.toISOString(),
  };
  const targetType = parseTargetType(record.targetType);
  if (action.data === AuditActions.ROLE_PERMISSIONS_REPLACED) {
    if (targetType !== "role") throw corruptedAuditEvent();
    return {
      ...base,
      action: action.data,
      targetType,
      before: parsePermissionKeysPayload(record.beforeJson),
      after: parsePermissionKeysPayload(record.afterJson),
    };
  }

  if (targetType !== "user") throw corruptedAuditEvent();
  return {
    ...base,
    action: action.data,
    targetType,
    before: parseRoleKeysPayload(record.beforeJson),
    after: parseRoleKeysPayload(record.afterJson),
  };
}
