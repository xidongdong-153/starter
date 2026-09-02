import { relations } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from '@api/modules/auth/auth.schema.js'

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' })

export const roles = sqliteTable(
  'roles',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [uniqueIndex('roles_key_unique').on(table.key), index('roles_archived_at_idx').on(table.archivedAt)],
)

export const permissions = sqliteTable(
  'permissions',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    description: text('description'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('permissions_key_unique').on(table.key),
    uniqueIndex('permissions_resource_action_unique').on(table.resource, table.action),
    index('permissions_archived_at_idx').on(table.archivedAt),
  ],
)

export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').notNull(),
    assignedBy: text('assigned_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_roles_role_user_idx').on(table.roleId, table.userId),
  ],
)

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').notNull(),
    assignedBy: text('assigned_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('role_permissions_permission_role_idx').on(table.permissionId, table.roleId),
  ],
)

/**
 * 授权审计事件，追加式。
 *
 * `actorId` 和 `targetId` 不设外键：用户或角色删除后历史必须保留，
 * 这与 `user_roles` 的级联删除策略相反，是有意的。
 * 不加 relations()，避免把它当成可 join 的业务表。
 */
export const authorizationAuditEvents = sqliteTable(
  'authorization_audit_events',
  {
    id: text('id').primaryKey(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    beforeJson: text('before_json').notNull(),
    afterJson: text('after_json').notNull(),
    reason: text('reason'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('authorization_audit_created_at_idx').on(table.createdAt, table.id),
    index('authorization_audit_actor_idx').on(table.actorId, table.createdAt),
    index('authorization_audit_action_idx').on(table.action, table.createdAt),
    index('authorization_audit_target_idx').on(table.targetId, table.createdAt),
  ],
)

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}))

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(user, {
    fields: [userRoles.userId],
    references: [user.id],
    relationName: 'userAssignedRoles',
  }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
  assigner: one(user, {
    fields: [userRoles.assignedBy],
    references: [user.id],
    relationName: 'userRoleAssigner',
  }),
}))

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
  assigner: one(user, {
    fields: [rolePermissions.assignedBy],
    references: [user.id],
    relationName: 'rolePermissionAssigner',
  }),
}))
