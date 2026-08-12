import type {
  AuditPermissionKeysPayload,
  AuditRoleCreatedAfter,
  AuditRoleCreatedBefore,
  AuditRoleKeysPayload,
  AuditRoleLifecyclePayload,
  AuditRoleMetadataPayload,
  AuditUserStatusPayload,
  RoleLifecycleAuditAction,
  UserRolesAuditAction,
} from "@starter/contracts";
import type { AppDatabase } from "@api/infra/db/client.js";
import { AuditActions, RoleKeys } from "@starter/contracts";
import { authorizationAuditEvents } from "@api/infra/db/schema/index.js";
import { generateId } from "@api/shared/id.js";

/**
 * 审计事件构造器。
 *
 * 这个文件只允许导入 `@starter/contracts`、schema 汇总入口和 id 生成器。
 * 不导入 `@api/modules/auth/*`：`auth.config.ts` 的 user create hook 会导入本文件，
 * 反向导入会形成循环依赖。
 *
 * payload 只接受已经算好的 key 数组，不接受数据库 record。
 * 因为类型是封闭的，事件里不可能出现密码哈希、token 或 cookie。
 */
interface AuditEventInputBase {
  actorType: "user" | "system";
  actorId: string;
  targetId: string;
  requestId: string | null;
  reason?: string | null;
}

export type AuditEventInput = AuditEventInputBase &
  (
    | {
        action: UserRolesAuditAction;
        targetType: "user";
        before: AuditRoleKeysPayload;
        after: AuditRoleKeysPayload;
      }
    | {
        action: typeof AuditActions.ROLE_PERMISSIONS_REPLACED;
        targetType: "role";
        before: AuditPermissionKeysPayload;
        after: AuditPermissionKeysPayload;
      }
    | {
        action: typeof AuditActions.ROLE_CREATED;
        targetType: "role";
        before: AuditRoleCreatedBefore;
        after: AuditRoleCreatedAfter;
      }
    | {
        action: typeof AuditActions.ROLE_UPDATED;
        targetType: "role";
        before: AuditRoleMetadataPayload;
        after: AuditRoleMetadataPayload;
      }
    | {
        action: RoleLifecycleAuditAction;
        targetType: "role";
        before: AuditRoleLifecyclePayload;
        after: AuditRoleLifecyclePayload;
      }
    | {
        action: typeof AuditActions.USER_STATUS_CHANGED;
        targetType: "user";
        before: AuditUserStatusPayload;
        after: AuditUserStatusPayload;
      }
  );

/** 写 transaction 句柄，与 `authorization.repository.ts` 的 TxLike 同源。 */
type AuditTxLike = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

/**
 * 按目标用户的 admin 成员关系变化选择 action。
 *
 * before/after 都写完整角色集合：`platform_admin.granted` 不是「只记 admin 变化」，
 * 而是「这次变化里包含 admin 授予」的标签。
 */
export function resolveUserRolesAction(
  before: string[],
  after: string[],
): UserRolesAuditAction {
  const hadAdmin = before.includes(RoleKeys.ADMIN);
  const hasAdmin = after.includes(RoleKeys.ADMIN);
  if (!hadAdmin && hasAdmin) return AuditActions.PLATFORM_ADMIN_GRANTED;
  if (hadAdmin && !hasAdmin) return AuditActions.PLATFORM_ADMIN_REVOKED;
  return AuditActions.USER_ROLES_REPLACED;
}

/**
 * 逐 action 显式投影 payload 字段。
 * 调用方变量可能带额外字段（结构类型），不投影会把它们写进审计 JSON。
 */
function projectPayloads(input: AuditEventInput): {
  before: unknown;
  after: unknown;
} {
  switch (input.action) {
    case AuditActions.ROLE_PERMISSIONS_REPLACED:
      return {
        before: { permissionKeys: input.before.permissionKeys },
        after: { permissionKeys: input.after.permissionKeys },
      };
    case AuditActions.ROLE_CREATED:
      return {
        before: { role: null },
        after: {
          role: {
            name: input.after.role.name,
            description: input.after.role.description,
            permissionKeys: input.after.role.permissionKeys,
            archived: false,
          },
        },
      };
    case AuditActions.ROLE_UPDATED:
      return {
        before: {
          name: input.before.name,
          description: input.before.description,
        },
        after: { name: input.after.name, description: input.after.description },
      };
    case AuditActions.ROLE_ARCHIVED:
    case AuditActions.ROLE_RESTORED:
      return {
        before: { archived: input.before.archived },
        after: { archived: input.after.archived },
      };
    case AuditActions.USER_STATUS_CHANGED:
      return {
        before: { status: input.before.status },
        after: { status: input.after.status },
      };
    default:
      return {
        before: { roleKeys: input.before.roleKeys },
        after: { roleKeys: input.after.roleKeys },
      };
  }
}

/** 写一条审计事件。必须在关系写入所处的同一 transaction 内调用。 */
export function insertAuditEvent(
  tx: AuditTxLike,
  input: AuditEventInput,
): void {
  const payloads = projectPayloads(input);

  tx.insert(authorizationAuditEvents)
    .values({
      id: generateId(),
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      beforeJson: JSON.stringify(payloads.before),
      afterJson: JSON.stringify(payloads.after),
      reason: input.reason ?? null,
      requestId: input.requestId,
      createdAt: new Date(),
    })
    .run();
}
